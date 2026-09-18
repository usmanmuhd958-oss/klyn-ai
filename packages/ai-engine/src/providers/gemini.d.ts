import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk } from "./types.js";
export declare class GeminiAdapter implements ProviderAdapter {
    private readonly baseUrl;
    readonly name: "gemini";
    constructor(baseUrl?: string);
    generate(request: ProviderRequest): Promise<ProviderResponse>;
    stream(request: ProviderRequest): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=gemini.d.ts.map