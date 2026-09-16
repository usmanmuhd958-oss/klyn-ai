import { performance } from "node:perf_hooks";
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

export class TokenTelemetryStreamer {
  constructor(private readonly countTokens: TokenCounter) {}

  async *wrap(stream: AsyncIterable<StreamChunk>, metadata: Pick<TokenTelemetry, "requestId" | "provider" | "model">, inputTokens = 0): AsyncGenerator<StreamChunk> {
    const started = performance.now();
    const telemetry: TokenTelemetry = { ...metadata, startedAt: Date.now(), inputTokens, outputTokens: 0, chunks: 0 };
    let first = true;
    try {
      for await (const chunk of stream) {
        telemetry.chunks++;
        if (chunk.text) {
          telemetry.outputTokens += this.countTokens(chunk.text);
          if (first) { first = false; telemetry.firstTokenAt = Date.now(); telemetry.timeToFirstTokenMs = performance.now() - started; }
        }
        yield chunk;
      }
    } finally {
      telemetry.completedAt = Date.now();
      telemetry.latencyMs = performance.now() - started;
      this.records.push(Object.freeze({ ...telemetry }));
    }
  }

  private readonly records: TokenTelemetry[] = [];
  snapshot(): readonly TokenTelemetry[] { return this.records.map((record) => Object.freeze({ ...record })); }
}
