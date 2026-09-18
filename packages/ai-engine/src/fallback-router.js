import { performance } from "node:perf_hooks";
import { ProviderError } from "./providers/http.js";
import { ProviderCircuitBreaker, ProviderCircuitOpenError } from "./circuit-breaker.js";
const DEFAULT_RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
function retryable(error, statuses) {
    if (error instanceof ProviderCircuitOpenError)
        return true;
    if (error instanceof ProviderError)
        return Boolean(error.retryable && (error.status === undefined || statuses.has(error.status) || error.status >= 500));
    return Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === true);
}
export class FallbackRouter {
    providers;
    circuitBreaker;
    telemetry = { attempts: 0, successes: 0, failures: 0, fallbackCount: 0, providerAttempts: {}, latencyMs: {} };
    maxRetries;
    statuses;
    constructor(providers, circuitBreaker = new ProviderCircuitBreaker(), policy = {}) {
        this.providers = providers;
        this.circuitBreaker = circuitBreaker;
        if (!providers.length)
            throw new Error("FallbackRouter requires at least one provider");
        this.maxRetries = Math.max(0, policy.maxRetriesPerProvider ?? 2);
        this.statuses = new Set(policy.retryableStatuses ?? [...DEFAULT_RETRYABLE]);
    }
    async complete(request) {
        let lastError;
        for (let index = 0; index < this.providers.length; index++) {
            const target = this.providers[index];
            if (request.model && target.model !== request.model)
                continue;
            if (!this.circuitBreaker.canRequest(target.provider)) {
                this.telemetry.fallbackCount++;
                continue;
            }
            for (let retry = 0; retry <= this.maxRetries; retry++) {
                const started = performance.now();
                this.telemetry.attempts++;
                this.telemetry.providerAttempts[target.provider] = (this.telemetry.providerAttempts[target.provider] ?? 0) + 1;
                try {
                    const response = await target.adapter.generate({ ...request, model: target.model });
                    const latencyMs = performance.now() - started;
                    this.circuitBreaker.recordSuccess(target.provider);
                    this.telemetry.successes++;
                    this.recordLatency(target.provider, latencyMs);
                    this.telemetry.lastAttempt = { provider: target.provider, model: target.model, latencyMs, success: true };
                    return response;
                }
                catch (error) {
                    lastError = error;
                    this.telemetry.failures++;
                    this.recordLatency(target.provider, performance.now() - started);
                    const backoff = this.circuitBreaker.recordFailure(target.provider);
                    if (!retryable(error, this.statuses) || retry === this.maxRetries)
                        break;
                    await this.sleep(backoff, request.signal);
                }
            }
            if (index < this.providers.length - 1)
                this.telemetry.fallbackCount++;
        }
        throw new Error(`All configured AI providers failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
    snapshot() { return JSON.parse(JSON.stringify(this.telemetry)); }
    async sleep(ms, signal) {
        if (!ms)
            return;
        await new Promise((resolve, reject) => {
            let settled = false;
            const timer = globalThis.setTimeout(() => { if (settled)
                return; settled = true; signal?.removeEventListener("abort", abort); resolve(); }, ms);
            const abort = () => { if (settled)
                return; settled = true; globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new Error("Operation aborted")); };
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted)
                abort();
        });
    }
    recordLatency(provider, durationMs) {
        const current = this.telemetry.latencyMs[provider] ?? { attempts: 0, totalMs: 0, averageMs: 0 };
        const attempts = current.attempts + 1;
        const totalMs = current.totalMs + durationMs;
        this.telemetry.latencyMs[provider] = { attempts, totalMs, averageMs: totalMs / attempts };
    }
}
export { ProviderCircuitBreaker as CircuitBreaker };
//# sourceMappingURL=fallback-router.js.map