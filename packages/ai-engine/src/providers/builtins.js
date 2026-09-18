import { AnthropicAdapter } from "./anthropic.js";
import { GeminiAdapter } from "./gemini.js";
import { OllamaAdapter } from "./ollama.js";
import { OpenAIAdapter } from "./openai.js";
import { UniversalChatAdapter } from "./universal.js";
const MANAGED_HOSTS = Object.freeze({
    openai: "api.openai.com",
    anthropic: "api.anthropic.com",
    gemini: "generativelanguage.googleapis.com",
    deepseek: "api.deepseek.com",
});
function isLoopback(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}
function assertTrustedEndpoint(provider, baseUrl, allowlistedRemoteHosts = []) {
    const url = new globalThis.URL(baseUrl);
    const host = url.hostname.toLowerCase();
    const allowedRemote = new Set(allowlistedRemoteHosts.map((value) => value.toLowerCase()));
    const managedHost = MANAGED_HOSTS[provider];
    if (url.username || url.password)
        throw new Error(`provider endpoint must not contain embedded credentials: ${provider}`);
    if (isLoopback(host)) {
        if (url.protocol !== "http:" && url.protocol !== "https:")
            throw new Error(`unsupported local provider protocol: ${provider}`);
        return;
    }
    if (url.protocol !== "https:")
        throw new Error(`remote provider endpoints must use HTTPS: ${provider}`);
    if (managedHost !== undefined && host === managedHost)
        return;
    if (allowedRemote.has(host))
        return;
    throw new Error(`provider endpoint host is not allowlisted: ${provider}`);
}
function apiKeyEnv(provider) {
    switch (provider) {
        case "openai": return "OPENAI_API_KEY";
        case "anthropic": return "ANTHROPIC_API_KEY";
        case "gemini": return "GEMINI_API_KEY";
        case "deepseek": return "DEEPSEEK_API_KEY";
        case "vllm": return "VLLM_API_KEY";
        case "ollama": return undefined;
    }
}
function createAdapter(config, baseUrl) {
    switch (config.provider) {
        case "openai": return new OpenAIAdapter(baseUrl);
        case "anthropic": return new AnthropicAdapter(baseUrl);
        case "gemini": return new GeminiAdapter(baseUrl);
        case "deepseek": return new UniversalChatAdapter({ name: "deepseek", baseUrl, apiKeyEnv: apiKeyEnv(config.provider) });
        case "vllm": return new UniversalChatAdapter({ name: "vllm", baseUrl, apiKeyEnv: process.env.VLLM_API_KEY?.trim() ? "VLLM_API_KEY" : undefined });
        case "ollama": return new OllamaAdapter(baseUrl);
    }
}
function defaultBaseUrl(provider) {
    switch (provider) {
        case "openai": return "https://api.openai.com/v1";
        case "anthropic": return "https://api.anthropic.com/v1";
        case "gemini": return "https://generativelanguage.googleapis.com/v1beta";
        case "deepseek": return "https://api.deepseek.com/v1";
        case "vllm": return "http://127.0.0.1:8000/v1";
        case "ollama": return "http://127.0.0.1:11434";
    }
}
export function createBuiltinProvider(config) {
    if (!config.id.trim())
        throw new Error("provider id is required");
    if (!config.model.trim())
        throw new Error("provider model is required");
    if (!Number.isSafeInteger(config.contextWindowTokens) || config.contextWindowTokens <= 0)
        throw new Error("contextWindowTokens must be a positive safe integer");
    const baseUrl = (config.baseUrl ?? defaultBaseUrl(config.provider)).replace(/\/$/, "");
    assertTrustedEndpoint(config.provider, baseUrl, config.allowlistedRemoteHosts);
    const pricing = {
        inputMicrousdPer1kTokens: config.inputMicrousdPer1kTokens ?? 0,
        outputMicrousdPer1kTokens: config.outputMicrousdPer1kTokens ?? 0,
    };
    if (!Number.isFinite(pricing.inputMicrousdPer1kTokens) || pricing.inputMicrousdPer1kTokens < 0)
        throw new Error("input pricing must be a non-negative finite number");
    if (!Number.isFinite(pricing.outputMicrousdPer1kTokens) || pricing.outputMicrousdPer1kTokens < 0)
        throw new Error("output pricing must be a non-negative finite number");
    return Object.freeze({
        id: config.id,
        definition: Object.freeze({
            provider: config.provider,
            model: config.model,
            contextWindowTokens: config.contextWindowTokens,
            capabilities: new Set(config.capabilities ?? []),
            pricing: Object.freeze(pricing),
            dataResidencies: config.dataResidencies,
            tags: config.tags,
        }),
        adapter: createAdapter(config, baseUrl),
    });
}
export function createDefaultBuiltinProvider(provider, model, contextWindowTokens) {
    return createBuiltinProvider({ id: `${provider}:${model}`, provider, model, contextWindowTokens });
}
//# sourceMappingURL=builtins.js.map