import { performance } from "node:perf_hooks";
export class TokenTelemetryStreamer {
    countTokens;
    constructor(countTokens) {
        this.countTokens = countTokens;
    }
    async *wrap(stream, metadata, inputTokens = 0) {
        const started = performance.now();
        const telemetry = { ...metadata, startedAt: Date.now(), inputTokens, outputTokens: 0, chunks: 0 };
        let first = true;
        try {
            for await (const chunk of stream) {
                telemetry.chunks++;
                if (chunk.text) {
                    telemetry.outputTokens += this.countTokens(chunk.text);
                    if (first) {
                        first = false;
                        telemetry.firstTokenAt = Date.now();
                        telemetry.timeToFirstTokenMs = performance.now() - started;
                    }
                }
                yield chunk;
            }
        }
        finally {
            telemetry.completedAt = Date.now();
            telemetry.latencyMs = performance.now() - started;
            this.records.push(Object.freeze({ ...telemetry }));
        }
    }
    records = [];
    snapshot() { return this.records.map((record) => Object.freeze({ ...record })); }
}
//# sourceMappingURL=token-telemetry-streamer.js.map