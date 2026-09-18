export interface CircuitBreakerOptions {
    readonly failureThreshold?: number;
    readonly cooldownMs?: number;
    readonly maxBackoffMs?: number;
    readonly baseBackoffMs?: number;
}
export declare class ProviderCircuitOpenError extends Error {
    readonly provider: string;
    readonly retryAfterMs: number;
    readonly retryable = true;
    constructor(provider: string, retryAfterMs: number);
}
export declare class ProviderCircuitBreaker {
    private readonly states;
    private readonly failureThreshold;
    private readonly cooldownMs;
    private readonly maxBackoffMs;
    private readonly baseBackoffMs;
    constructor(options?: CircuitBreakerOptions);
    canRequest(provider: string): boolean;
    assertRequestAllowed(provider: string): void;
    recordSuccess(provider: string): void;
    recordFailure(provider: string): number;
    reset(provider?: string): void;
    snapshot(): Readonly<Record<string, {
        failures: number;
        open: boolean;
    }>>;
}
//# sourceMappingURL=circuit-breaker.d.ts.map