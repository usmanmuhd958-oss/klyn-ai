import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk } from "./types.js";
export declare class OpenAIAdapter implements ProviderAdapter {
    private readonly baseUrl;
    readonly name: "openai";
    constructor(baseUrl?: string);
    generate(request: ProviderRequest): Promise<ProviderResponse>;
    stream(request: ProviderRequest): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=openai.d.ts.map