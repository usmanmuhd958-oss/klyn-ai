import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderName, StreamChunk } from "./types.js";
export declare class ReplicateAdapter implements ProviderAdapter {
    readonly name: ProviderName;
    private readonly baseUrl;
    generate(request: ProviderRequest): Promise<ProviderResponse>;
    stream(request: ProviderRequest): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=replicate.d.ts.map