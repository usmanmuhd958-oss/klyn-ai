import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk } from "./types.js";
export declare class AnthropicAdapter implements ProviderAdapter {
    private readonly baseUrl;
    readonly name: "anthropic";
    constructor(baseUrl?: string);
    generate(request: ProviderRequest): Promise<ProviderResponse>;
    stream(request: ProviderRequest): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=anthropic.d.ts.map