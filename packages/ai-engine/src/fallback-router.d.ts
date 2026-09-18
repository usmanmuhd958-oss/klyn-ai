import type { ProviderAdapter, ProviderName, ProviderResponse, ProviderRequest } from "./providers/types.js";
import { ProviderCircuitBreaker } from "./circuit-breaker.js";
export type FallbackProvider = {
    provider: ProviderName;
    model: string;
    adapter: ProviderAdapter;
};
export type FallbackPolicy = {
    maxRetriesPerProvider?: number;
    retryableStatuses?: readonly number[];
};
export type FallbackAttempt = {
    provider: ProviderName;
    model: string;
    latencyMs: number;
    success: boolean;
    error?: string;
};
export type FallbackTelemetry = {
    attempts: number;
    successes: number;
    failures: number;
    fallbackCount: number;
    providerAttempts: Record<string, number>;
    latencyMs: Record<string, {
        attempts: number;
        totalMs: number;
        averageMs: number;
    }>;
    lastAttempt?: FallbackAttempt;
};
export declare class FallbackRouter {
    readonly providers: readonly FallbackProvider[];
    readonly circuitBreaker: ProviderCircuitBreaker;
    readonly telemetry: FallbackTelemetry;
    private readonly maxRetries;
    private readonly statuses;
    constructor(providers: readonly FallbackProvider[], circuitBreaker?: ProviderCircuitBreaker, policy?: FallbackPolicy);
    complete(request: ProviderRequest): Promise<ProviderResponse>;
    snapshot(): Readonly<FallbackTelemetry>;
    private sleep;
    private recordLatency;
}
export { ProviderCircuitBreaker as CircuitBreaker };
//# sourceMappingURL=fallback-router.d.ts.map