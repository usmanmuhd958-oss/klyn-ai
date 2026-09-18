import type { ProviderName } from "./types.js";
import type { AiEngineProvider } from "../control-plane/types.js";
export interface BuiltinProviderConfig {
    readonly id: string;
    readonly provider: Exclude<ProviderName, "openrouter" | "groq" | "together" | "fireworks" | "replicate" | "mistral" | "cohere" | "lmstudio" | "custom">;
    readonly model: string;
    readonly baseUrl?: string;
    readonly contextWindowTokens: number;
    readonly capabilities?: readonly ("reasoning" | "structured-output" | "tool-use" | "vision" | "audio")[];
    readonly inputMicrousdPer1kTokens?: number;
    readonly outputMicrousdPer1kTokens?: number;
    readonly dataResidencies?: readonly string[];
    readonly tags?: readonly string[];
    readonly allowlistedRemoteHosts?: readonly string[];
}
export declare function createBuiltinProvider(config: BuiltinProviderConfig): AiEngineProvider;
export declare function createDefaultBuiltinProvider(provider: BuiltinProviderConfig["provider"], model: string, contextWindowTokens: number): AiEngineProvider;
//# sourceMappingURL=builtins.d.ts.map