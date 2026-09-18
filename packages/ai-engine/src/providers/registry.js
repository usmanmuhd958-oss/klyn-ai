const capabilities = new Map();
export function registerModelCapability(capability) {
    if (!capability.id.trim())
        throw new Error("Model capability id is required");
    if (!Number.isSafeInteger(capability.maxContextTokens) || capability.maxContextTokens <= 0) {
        throw new Error("maxContextTokens must be a positive integer");
    }
    capabilities.set(capability.id, Object.freeze({ ...capability }));
}
export function getModelCapability(id) {
    return capabilities.get(id);
}
export function listModelCapabilities(provider) {
    return [...capabilities.values()].filter((model) => !provider || model.provider === provider);
}
export function registerModelCapabilities(models) {
    for (const model of models)
        registerModelCapability(model);
}
// Pricing is intentionally configuration data, not hard-coded into routing logic.
// Set cost values to 0 when the provider/model is free, local, or not configured.
registerModelCapabilities([
    { id: "openai/gpt-4o", provider: "openai", maxContextTokens: 128000, supportsFunctionCalling: true, supportsStreaming: true, supportsReasoning: false, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
    { id: "openai/gpt-4o-mini", provider: "openai", maxContextTokens: 128000, supportsFunctionCalling: true, supportsStreaming: true, supportsReasoning: false, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
    { id: "anthropic/claude-3-5-sonnet", provider: "anthropic", maxContextTokens: 200000, supportsFunctionCalling: true, supportsStreaming: true, supportsReasoning: false, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
    { id: "google/gemini-2.0-flash", provider: "gemini", maxContextTokens: 1000000, supportsFunctionCalling: true, supportsStreaming: true, supportsReasoning: false, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
    { id: "deepseek/deepseek-r1", provider: "deepseek", maxContextTokens: 128000, supportsFunctionCalling: false, supportsStreaming: true, supportsReasoning: true, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
    { id: "deepseek/deepseek-v3", provider: "deepseek", maxContextTokens: 128000, supportsFunctionCalling: true, supportsStreaming: true, supportsReasoning: false, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
    { id: "mistral/codestral", provider: "mistral", maxContextTokens: 256000, supportsFunctionCalling: true, supportsStreaming: true, supportsReasoning: false, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
    { id: "groq/llama-3.3-70b-versatile", provider: "groq", maxContextTokens: 131072, supportsFunctionCalling: true, supportsStreaming: true, supportsReasoning: false, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
    { id: "ollama/qwen2.5-coder", provider: "ollama", maxContextTokens: 32768, supportsFunctionCalling: true, supportsStreaming: true, supportsReasoning: false, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
    { id: "ollama/deepseek-r1", provider: "ollama", maxContextTokens: 128000, supportsFunctionCalling: false, supportsStreaming: true, supportsReasoning: true, costPer1kInputTokens: 0, costPer1kOutputTokens: 0 },
]);
//# sourceMappingURL=registry.js.map