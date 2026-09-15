import { z } from "zod";
import { ProviderError } from "./providers/http.js";
import type { ProviderAdapter, ProviderName } from "./providers/types.js";

export const CompletionRequestSchema = z.object({ model: z.string().optional(), system: z.string().optional(), input: z.string().min(1), maxOutputTokens: z.number().int().positive().optional(), temperature: z.number().min(0).max(2).optional(), signal: z.custom<AbortSignal>().optional(), responseFormat: z.enum(["text", "json"]).default("text") });
export const CompletionResponseSchema = z.object({ provider: z.string(), model: z.string(), output: z.string(), usage: z.object({ inputTokens: z.number().nonnegative().optional(), outputTokens: z.number().nonnegative().optional() }).optional(), requestId: z.string().optional() });
export const TokenUsageSchema = z.object({ inputTokens: z.number().nonnegative().default(0), outputTokens: z.number().nonnegative().default(0) });
export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;
export type CompletionResponse = z.infer<typeof CompletionResponseSchema>;
export type RetryPolicy = { maxRetriesPerProvider?: number; baseDelayMs?: number; maxDelayMs?: number; jitter?: number };
export type RouterProvider = { provider: ProviderName; model: string; adapter: ProviderAdapter };
export type RouterMetrics = { attempts: number; retries: number; providerAttempts: Record<string, number>; usage: { inputTokens: number; outputTokens: number } };
const TRANSIENT = new Set([408, 409, 429, 502, 503, 504]);
function isRetryable(error: unknown): boolean { return error instanceof ProviderError ? error.retryable && (error.status === undefined || TRANSIENT.has(error.status) || error.status >= 500) : Boolean(error && typeof error === "object" && "retryable" in error && (error as { retryable?: unknown }).retryable === true); }
function backoff(attempt: number, p: Required<RetryPolicy>, random: () => number): number { const exp = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** attempt); return Math.max(0, Math.round(exp * (1 + (random() * 2 - 1) * p.jitter))); }
function sleep(ms: number, signal?: AbortSignal): Promise<void> { if (!ms) return Promise.resolve(); return new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error("Operation aborted")); }; signal?.addEventListener("abort", abort, { once: true }); }); }

export class RouterPipeline {
  readonly metrics: RouterMetrics = { attempts: 0, retries: 0, providerAttempts: {}, usage: { inputTokens: 0, outputTokens: 0 } };
  private readonly policy: Required<RetryPolicy>;
  constructor(private readonly providers: RouterProvider[], policy: RetryPolicy = {}) {
    if (!providers.length) throw new Error("RouterPipeline requires at least one provider");
    this.policy = { maxRetriesPerProvider: policy.maxRetriesPerProvider ?? 3, baseDelayMs: policy.baseDelayMs ?? 25, maxDelayMs: policy.maxDelayMs ?? 1000, jitter: policy.jitter ?? 0.2 };
  }
  async complete(input: CompletionRequest, schema?: z.ZodType): Promise<CompletionResponse> {
    const request = CompletionRequestSchema.parse(input); let lastError: unknown;
    for (const target of this.providers) {
      if (request.model && target.model !== request.model) continue;
      for (let retry = 0; retry <= this.policy.maxRetriesPerProvider; retry++) {
        this.metrics.attempts++; this.metrics.providerAttempts[target.provider] = (this.metrics.providerAttempts[target.provider] ?? 0) + 1;
        try {
          const response = CompletionResponseSchema.parse(await target.adapter.generate({ ...request, model: target.model }));
          this.recordUsage(response);
          if (schema) { let value: unknown; try { value = JSON.parse(response.output); } catch { throw new Error("Provider returned invalid JSON for structured output"); } schema.parse(value); }
          return response;
        } catch (error) {
          lastError = error; if (!isRetryable(error)) throw error;
          if (retry === this.policy.maxRetriesPerProvider) break;
          this.metrics.retries++; await sleep(backoff(retry, this.policy, Math.random), request.signal);
        }
      }
    }
    throw new Error(`All configured AI providers failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
  private recordUsage(response: CompletionResponse): void { this.metrics.usage.inputTokens += response.usage?.inputTokens ?? 0; this.metrics.usage.outputTokens += response.usage?.outputTokens ?? 0; }
}
