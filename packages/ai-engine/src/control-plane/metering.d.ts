import type { AiEngineProvider, TokenMeterRecord } from "./types.js";
export declare class TokenCostMeter {
    private readonly records;
    private totalCostMicrousd;
    private totalInputTokens;
    private totalOutputTokens;
    record(provider: AiEngineProvider, inputTokens?: number, outputTokens?: number, recordedAt?: number): TokenMeterRecord;
    snapshot(): readonly TokenMeterRecord[];
    totals(): {
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly costMicrousd: number;
    };
}
//# sourceMappingURL=metering.d.ts.map