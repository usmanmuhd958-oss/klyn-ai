import { z } from "zod";
import { type CircuitBreakerOptions } from "./circuit-breaker.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk, ProviderName } from "./providers/types.js";
export interface Telemetry {
    onStart?(event: {
        provider: ProviderName;
        model: string;
    }): void;
    onSuccess?(event: {
        provider: ProviderName;
        model: string;
        latencyMs: number;
        outputTokens?: number;
    }): void;
    onError?(event: {
        provider: ProviderName;
        model: string;
        latencyMs: number;
        error: unknown;
        retryable: boolean;
    }): void;
}
export interface RouteTarget {
    provider: ProviderName;
    model: string;
}
export interface RouterOptions {
    targets: RouteTarget[];
    adapters?: Partial<Record<ProviderName, ProviderAdapter>>;
    telemetry?: Telemetry;
    maxAttempts?: number;
    circuitBreaker?: CircuitBreakerOptions;
}
export declare class AIProviderRouter {
    private readonly options;
    private readonly adapters;
    private readonly telemetry?;
    private readonly maxAttempts;
    private readonly breaker;
    constructor(options: RouterOptions);
    generate(input: Omit<ProviderRequest, "model"> & {
        model?: string;
    }): Promise<ProviderResponse>;
    stream(input: Omit<ProviderRequest, "model"> & {
        model?: string;
    }): AsyncIterable<StreamChunk>;
    generateStructured<T>(input: Omit<ProviderRequest, "model" | "responseFormat"> & {
        model?: string;
    }, schema: z.ZodType<T>): Promise<{
        data: T;
        response: ProviderResponse;
    }>;
    circuitSnapshot(): Readonly<Record<string, {
        failures: number;
        open: boolean;
    }>>;
    resetCircuit(provider?: ProviderName): void;
    private createUniversalAdapters;
    private requireAdapter;
}
//# sourceMappingURL=router.d.ts.map