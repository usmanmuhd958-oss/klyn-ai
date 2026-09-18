import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk } from "./types.js";
export declare class OllamaAdapter implements ProviderAdapter {
    private readonly baseUrl;
    readonly name: "ollama";
    constructor(baseUrl?: string);
    generate(request: ProviderRequest): Promise<ProviderResponse>;
    stream(request: ProviderRequest): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=ollama.d.ts.map