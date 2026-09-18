import { performance } from "node:perf_hooks";
import { ProviderError } from "../providers/http.js";
import { ContextSelector } from "./context-selector.js";
import { ProviderHealthTracker } from "./health.js";
import { TokenCostMeter } from "./metering.js";
import { AiEngineError, } from "./types.js";
const DEFAULT_ROUTING = {
    objective: "balanced",
    maxAttempts: 3,
    maxOutputTokens: 2048,
};
function estimateTokens(text) {
    return Math.max(1, Math.ceil(text.length / 4));
}
function errorDetails(error) {
    if (error instanceof ProviderError) {
        if (error.status === 401 || error.status === 403)
            return { retryable: false, status: error.status, code: "PROVIDER_AUTH" };
        if (error.status === 429)
            return { retryable: true, status: error.status, code: "PROVIDER_RATE_LIMITED" };
        if (error.status !== undefined && error.status >= 500)
            return { retryable: true, status: error.status, code: "PROVIDER_UNAVAILABLE" };
        return { retryable: error.retryable, status: error.status, code: "PROVIDER_FAILURE" };
    }
    if (error instanceof Error && error.name === "AbortError")
        return { retryable: false, code: "ABORTED" };
    return { retryable: false, code: "PROVIDER_FAILURE" };
}
function capabilitySetContainsAll(provider, required) {
    if (!required || required.length === 0)
        return true;
    return required.every((capability) => provider.definition.capabilities.has(capability));
}
function hasResidency(provider, preferred) {
    if (!preferred || preferred.length === 0)
        return true;
    const residences = new Set(provider.definition.dataResidencies ?? []);
    return preferred.some((location) => residences.has(location));
}
function scoreProvider(provider, health, objective, estimatedInputTokens, maxOutputTokens, preferredResidencies) {
    const pricing = provider.definition.pricing;
    const projectedCost = (estimatedInputTokens * pricing.inputMicrousdPer1kTokens + maxOutputTokens * pricing.outputMicrousdPer1kTokens) / 1000;
    const latency = health.averageLatencyMs ?? 500;
    const reliability = health.totalSuccesses + health.totalFailures === 0
        ? 0.5
        : health.totalSuccesses / (health.totalSuccesses + health.totalFailures);
    const residency = hasResidency(provider, preferredResidencies) ? 1 : 0;
    const quality = provider.definition.evaluationScore ?? 0;
    switch (objective) {
        case "quality": return quality * 1_000_000 + reliability * 10_000 - latency - projectedCost / 100;
        case "latency": return -latency * 1_000 - projectedCost / 100;
        case "cost": return -projectedCost * 1_000 + reliability * 100;
        case "reliability": return reliability * 1_000_000 - latency;
        case "data-sovereignty": return residency * 1_000_000 + reliability * 10_000 - latency;
        case "balanced": return quality * 100_000 + reliability * 10_000 + residency * 1_000 - latency - projectedCost;
    }
}
function composeInput(input, context) {
    if (context.selected.length === 0)
        return input;
    const sections = context.selected.map((item) => `<context id="${item.id.replaceAll('"', "&quot;")}">\n${item.content}\n</context>`);
    return `${sections.join("\n\n")}\n\n<task>\n${input}\n</task>`;
}
function deadlineSignal(requestSignal, timeoutMs) {
    const controller = new globalThis.AbortController();
    const abortFromRequest = () => controller.abort(requestSignal?.reason);
    if (requestSignal) {
        requestSignal.addEventListener("abort", abortFromRequest, { once: true });
        if (requestSignal.aborted)
            abortFromRequest();
    }
    const timer = setTimeout(() => controller.abort(new Error("provider request timed out")), timeoutMs);
    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timer);
            requestSignal?.removeEventListener("abort", abortFromRequest);
        },
    };
}
export class AiEngine {
    health;
    meter;
    providers;
    routing;
    contextSelector;
    requestTimeoutMs;
    constructor(providers, options = {}) {
        if (providers.length === 0)
            throw new AiEngineError("NO_PROVIDER", "AiEngine requires at least one provider");
        const ids = new Set();
        for (const provider of providers) {
            if (ids.has(provider.id))
                throw new AiEngineError("INVALID_REQUEST", `duplicate provider id: ${provider.id}`);
            ids.add(provider.id);
            if (!provider.definition.model.trim())
                throw new AiEngineError("INVALID_REQUEST", `provider model is required: ${provider.id}`);
            if (provider.definition.evaluationScore !== undefined && (provider.definition.evaluationScore < 0 || provider.definition.evaluationScore > 1)) {
                throw new AiEngineError("INVALID_REQUEST", `evaluationScore must be between 0 and 1: ${provider.id}`);
            }
        }
        this.providers = [...providers];
        this.routing = { ...DEFAULT_ROUTING, ...options.routing };
        if (!Number.isInteger(this.routing.maxAttempts) || this.routing.maxAttempts < 1)
            throw new AiEngineError("INVALID_REQUEST", "maxAttempts must be a positive integer");
        if (!Number.isInteger(this.routing.maxOutputTokens) || this.routing.maxOutputTokens <= 0)
            throw new AiEngineError("INVALID_REQUEST", "maxOutputTokens must be a positive integer");
        this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
        if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0)
            throw new AiEngineError("INVALID_REQUEST", "requestTimeoutMs must be positive");
        this.health = new ProviderHealthTracker(options.health);
        this.meter = options.meter ?? new TokenCostMeter();
        this.contextSelector = new ContextSelector({ maxTokens: this.routing.contextBudgetTokens ?? 16_000, reserveTokens: 2_000, maxItems: 64 });
    }
    async complete(request, routingOverride = {}) {
        const input = request.input.trim();
        if (!input)
            throw new AiEngineError("INVALID_REQUEST", "input is required");
        const routing = { ...this.routing, ...routingOverride };
        if (routing.deniedProviders?.some((provider) => routing.allowedProviders?.includes(provider))) {
            throw new AiEngineError("POLICY_VIOLATION", "provider is both allowed and denied");
        }
        if (request.signal?.aborted)
            throw new AiEngineError("ABORTED", "AI request was aborted", { cause: request.signal.reason });
        const estimatedRequestTokens = estimateTokens(`${request.system ?? ""}\n${input}`);
        const contexts = this.selectContext(request, routing);
        const contextTokens = contexts.estimatedTokens;
        const effectiveInput = composeInput(input, contexts);
        const maxOutputTokens = request.maxOutputTokens ?? routing.maxOutputTokens;
        if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0)
            throw new AiEngineError("INVALID_REQUEST", "maxOutputTokens must be a positive integer");
        const candidates = this.selectCandidates(request.model, routing, estimatedRequestTokens + contextTokens, maxOutputTokens);
        if (candidates.length === 0)
            throw new AiEngineError("NO_PROVIDER", "no provider satisfies the routing policy");
        let attempts = 0;
        let lastError;
        for (const provider of candidates) {
            if (attempts >= routing.maxAttempts)
                break;
            if (!this.health.canAttempt(provider.id))
                continue;
            attempts += 1;
            const started = performance.now();
            const deadline = deadlineSignal(request.signal, this.requestTimeoutMs);
            try {
                const response = await provider.adapter.generate({
                    model: provider.definition.model,
                    system: request.system,
                    input: effectiveInput,
                    maxOutputTokens,
                    temperature: request.temperature,
                    responseFormat: request.responseFormat,
                    signal: deadline.signal,
                });
                if (response.provider !== provider.definition.provider || response.model !== provider.definition.model) {
                    throw new AiEngineError("PROVIDER_FAILURE", "provider response identity did not match the routed target", { providerId: provider.id, retryable: false });
                }
                if (request.responseFormat === "json") {
                    try {
                        JSON.parse(response.output);
                    }
                    catch (error) {
                        throw new AiEngineError("PROVIDER_FAILURE", "provider returned invalid JSON", { providerId: provider.id, cause: error, retryable: false });
                    }
                }
                const latencyMs = performance.now() - started;
                const health = this.health.recordSuccess(provider.id, latencyMs);
                const meterRecord = this.meter.record(provider, response.usage?.inputTokens, response.usage?.outputTokens);
                return {
                    response,
                    providerId: provider.id,
                    attempts,
                    fallbackCount: Math.max(0, attempts - 1),
                    context: contexts,
                    costMicrousd: meterRecord.costMicrousd,
                    health,
                };
            }
            catch (error) {
                const details = errorDetails(error);
                lastError = error;
                if (request.signal?.aborted)
                    throw new AiEngineError("ABORTED", "AI request was aborted", { providerId: provider.id, cause: request.signal.reason });
                if (deadline.signal.aborted) {
                    const cause = deadline.signal.reason;
                    const timeout = cause instanceof Error && cause.message === "provider request timed out";
                    if (timeout) {
                        this.health.recordFailure(provider.id, true);
                        continue;
                    }
                }
                if (details.code === "PROVIDER_AUTH") {
                    this.health.recordFailure(provider.id, false);
                    continue;
                }
                this.health.recordFailure(provider.id, details.retryable);
                if (!details.retryable)
                    continue;
            }
            finally {
                deadline.cleanup();
            }
        }
        const cause = lastError instanceof Error ? lastError.message : "unknown provider failure";
        throw new AiEngineError("ALL_PROVIDERS_FAILED", `all eligible AI providers failed: ${cause}`, { cause: lastError, retryable: false });
    }
    healthSnapshot() {
        return this.health.snapshotAll();
    }
    selectContext(request, routing) {
        const requestTokens = estimateTokens(`${request.system ?? ""}\n${request.input}`);
        const configuredBudget = routing.contextBudgetTokens ?? 16_000;
        try {
            return this.contextSelector.select(request.contexts ?? [], {
                maxTokens: Math.max(1, Math.min(configuredBudget, request.contextPolicy?.maxTokens ?? configuredBudget)),
                ...(request.contextPolicy ?? {}),
            });
        }
        catch (error) {
            throw new AiEngineError("CONTEXT_OVERFLOW", `context selection exceeded the configured context budget (request tokens: ${requestTokens})`, { cause: error });
        }
    }
    selectCandidates(model, routing, estimatedTotalInputTokens, maxOutputTokens) {
        const allowed = routing.allowedProviders ? new Set(routing.allowedProviders) : undefined;
        const denied = new Set(routing.deniedProviders ?? []);
        const candidates = this.providers.filter((provider) => {
            if (model && provider.definition.model !== model)
                return false;
            if (allowed && !allowed.has(provider.definition.provider))
                return false;
            if (denied.has(provider.definition.provider))
                return false;
            if (!capabilitySetContainsAll(provider, routing.requiredCapabilities))
                return false;
            if (routing.preferredDataResidencies?.length && routing.objective === "data-sovereignty" && !hasResidency(provider, routing.preferredDataResidencies))
                return false;
            if (estimatedTotalInputTokens + maxOutputTokens > provider.definition.contextWindowTokens)
                return false;
            if (routing.maxCostMicrousd !== undefined) {
                const estimate = (estimatedTotalInputTokens * provider.definition.pricing.inputMicrousdPer1kTokens + maxOutputTokens * provider.definition.pricing.outputMicrousdPer1kTokens) / 1000;
                if (estimate > routing.maxCostMicrousd)
                    return false;
            }
            return true;
        });
        return candidates.sort((a, b) => {
            const scoreA = scoreProvider(a, this.health.ensure(a.id), routing.objective, estimatedTotalInputTokens, maxOutputTokens, routing.preferredDataResidencies);
            const scoreB = scoreProvider(b, this.health.ensure(b.id), routing.objective, estimatedTotalInputTokens, maxOutputTokens, routing.preferredDataResidencies);
            if (scoreA !== scoreB)
                return scoreB - scoreA;
            return `${a.definition.provider}:${a.definition.model}:${a.id}`.localeCompare(`${b.definition.provider}:${b.definition.model}:${b.id}`);
        });
    }
}
//# sourceMappingURL=engine.js.map