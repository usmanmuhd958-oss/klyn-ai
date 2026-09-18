import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderName, StreamChunk } from "./types.js";
export interface UniversalProviderConfig {
    name: ProviderName;
    baseUrl: string;
    apiKeyEnv?: string;
    defaultHeaders?: Record<string, string>;
    extraBody?: Record<string, unknown>;
}
export declare class UniversalChatAdapter implements ProviderAdapter {
    readonly name: ProviderName;
    private readonly config;
    constructor(config: UniversalProviderConfig);
    generate(request: ProviderRequest): Promise<ProviderResponse>;
    stream(request: ProviderRequest): AsyncIterable<StreamChunk>;
    private headers;
}
export declare function createUniversalAdapter(config: UniversalProviderConfig): UniversalChatAdapter;
//# sourceMappingURL=universal.d.ts.map