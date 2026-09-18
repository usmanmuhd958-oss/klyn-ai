import type { ProviderHealthPolicy, ProviderHealthSnapshot, ProviderHealthState } from "./types.js";
interface MutableHealth {
    consecutiveFailures: number;
    totalSuccesses: number;
    totalFailures: number;
    latencySamples: number;
    averageLatencyMs?: number;
    lastSuccessAt?: number;
    lastFailureAt?: number;
    retryAfterAt?: number;
    state: ProviderHealthState;
}
export declare class ProviderHealthTracker {
    private readonly records;
    private readonly policy;
    constructor(policy?: Partial<ProviderHealthPolicy>);
    ensure(providerId: string): ProviderHealthSnapshot;
    recordSuccess(providerId: string, latencyMs: number, now?: number): ProviderHealthSnapshot;
    recordFailure(providerId: string, retryable: boolean, now?: number): ProviderHealthSnapshot;
    markRateLimited(providerId: string, retryAfterAt?: number, now?: number): ProviderHealthSnapshot;
    canAttempt(providerId: string, now?: number): boolean;
    snapshotAll(): readonly ProviderHealthSnapshot[];
    snapshot(providerId: string, record?: MutableHealth | undefined): ProviderHealthSnapshot;
    private create;
}
export {};
//# sourceMappingURL=health.d.ts.map