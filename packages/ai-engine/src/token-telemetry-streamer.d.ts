import type { StreamChunk } from "./providers/types.js";
export type TokenTelemetry = {
    requestId: string;
    provider: string;
    model: string;
    startedAt: number;
    firstTokenAt?: number;
    completedAt?: number;
    inputTokens: number;
    outputTokens: number;
    chunks: number;
    latencyMs?: number;
    timeToFirstTokenMs?: number;
};
export type TokenCounter = (text: string) => number;
export declare class TokenTelemetryStreamer {
    private readonly countTokens;
    constructor(countTokens: TokenCounter);
    wrap(stream: AsyncIterable<StreamChunk>, metadata: Pick<TokenTelemetry, "requestId" | "provider" | "model">, inputTokens?: number): AsyncGenerator<StreamChunk>;
    private readonly records;
    snapshot(): readonly TokenTelemetry[];
}
//# sourceMappingURL=token-telemetry-streamer.d.ts.map