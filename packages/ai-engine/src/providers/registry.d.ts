export type ProviderType = "openai" | "anthropic" | "gemini" | "deepseek" | "openrouter" | "groq" | "together" | "fireworks" | "replicate" | "mistral" | "cohere" | "ollama" | "vllm" | "lmstudio" | "custom";
export interface ModelCapability {
    id: string;
    provider: ProviderType;
    maxContextTokens: number;
    supportsFunctionCalling: boolean;
    supportsStreaming: boolean;
    supportsReasoning: boolean;
    costPer1kInputTokens: number;
    costPer1kOutputTokens: number;
}
export declare function registerModelCapability(capability: ModelCapability): void;
export declare function getModelCapability(id: string): ModelCapability | undefined;
export declare function listModelCapabilities(provider?: ProviderType): ModelCapability[];
export declare function registerModelCapabilities(models: readonly ModelCapability[]): void;
//# sourceMappingURL=registry.d.ts.map