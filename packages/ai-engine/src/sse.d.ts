import type { StreamChunk } from "./providers/types.js";
export declare function streamToSSE(chunks: AsyncIterable<StreamChunk>, signal?: AbortSignal): ReadableStream<Uint8Array>;
export declare function sseHeaders(): Headers;
//# sourceMappingURL=sse.d.ts.map