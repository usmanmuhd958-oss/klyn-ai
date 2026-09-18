import { z } from "zod";
import type { ProviderAdapter, ProviderName } from "./providers/types.js";
export declare const CompletionRequestSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
    system: z.ZodOptional<z.ZodString>;
    input: z.ZodString;
    maxOutputTokens: z.ZodOptional<z.ZodNumber>;
    temperature: z.ZodOptional<z.ZodNumber>;
    signal: z.ZodOptional<z.ZodCustom<AbortSignal, AbortSignal>>;
    responseFormat: z.ZodDefault<z.ZodEnum<{
        text: "text";
        json: "json";
    }>>;
}, z.core.$strip>;
export declare const CompletionResponseSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    output: z.ZodString;
    usage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    requestId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const TokenUsageSchema: z.ZodObject<{
    inputTokens: z.ZodDefault<z.ZodNumber>;
    outputTokens: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;
export type CompletionResponse = z.infer<typeof CompletionResponseSchema>;
export type RetryPolicy = {
    maxRetriesPerProvider?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitter?: number;
};
export type RouterProvider = {
    provider: ProviderName;
    model: string;
    adapter: ProviderAdapter;
};
export type ProviderLatencyMetric = {
    attempts: number;
    totalMs: number;
    averageMs: number;
};
export type RouterMetrics = {
    attempts: number;
    retries: number;
    failures: number;
    failureRate: number;
    providerAttempts: Record<string, number>;
    providerLatencyMs: Record<string, ProviderLatencyMetric>;
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
};
export declare class RouterPipeline {
    private readonly providers;
    readonly metrics: RouterMetrics;
    private readonly policy;
    constructor(providers: RouterProvider[], policy?: RetryPolicy);
    complete(input: CompletionRequest, schema?: z.ZodType): Promise<CompletionResponse>;
    private recordUsage;
    private recordLatency;
}
//# sourceMappingURL=provider-router.d.ts.map