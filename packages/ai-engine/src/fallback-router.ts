import { performance } from "node:perf_hooks";
import { ProviderError } from "./providers/http.js";
import type { ProviderAdapter, ProviderName, ProviderResponse, ProviderRequest } from "./providers/types.js";
import { ProviderCircuitBreaker, ProviderCircuitOpenError } from "./circuit-breaker.js";

export type FallbackProvider = { provider: ProviderName; model: string; adapter: ProviderAdapter };
export type FallbackPolicy = { maxRetriesPerProvider?: number; retryableStatuses?: readonly number[] };
export type FallbackAttempt = { provider: ProviderName; model: string; latencyMs: number; success: boolean; error?: string };
export type FallbackTelemetry = { attempts: number; successes: number; failures: number; fallbackCount: number; providerAttempts: Record<string, number>; latencyMs: Record<string, { attempts: number; totalMs: number; averageMs: number }>; lastAttempt?: FallbackAttempt };

const DEFAULT_RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

function retryable(error: unknown, statuses: Set<number>): boolean {
  if (error instanceof ProviderCircuitOpenError) return true;
  if (error instanceof ProviderError) return Boolean(error.retryable && (error.status === undefined || statuses.has(error.status) || error.status >= 500));
  return Boolean(error && typeof error === "object" && "retryable" in error && (error as { retryable?: unknown }).retryable === true);
}

export class FallbackRouter {
  readonly telemetry: FallbackTelemetry = { attempts: 0, successes: 0, failures: 0, fallbackCount: 0, providerAttempts: {}, latencyMs: {} };
  private readonly maxRetries: number;
  private readonly statuses: Set<number>;
  constructor(readonly providers: readonly FallbackProvider[], readonly circuitBreaker = new ProviderCircuitBreaker(), policy: FallbackPolicy = {}) {
    if (!providers.length) throw new Error("FallbackRouter requires at least one provider");
    this.maxRetries = Math.max(0, policy.maxRetriesPerProvider ?? 2);
    this.statuses = new Set(policy.retryableStatuses ?? [...DEFAULT_RETRYABLE]);
  }
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    let lastError: unknown;
    let attemptedProvider = false;
    for (const target of this.providers) {
      if (request.model && target.model !== request.model) continue;
      if (!this.circuitBreaker.canRequest(target.provider)) { this.telemetry.fallbackCount++; continue; }
      attemptedProvider = true;
      for (let retry = 0; retry <= this.maxRetries; retry++) {
        const started = performance.now();
        this.telemetry.attempts++;
        this.telemetry.providerAttempts[target.provider] = (this.telemetry.providerAttempts[target.provider] ?? 0) + 1;
        try {
          const response = await target.adapter.generate({ ...request, model: target.model });
          this.circuitBreaker.recordSuccess(target.provider);
          this.telemetry.successes++;
          this.recordLatency(target.provider, performance.now() - started);
          this.telemetry.lastAttempt = { provider: target.provider, model: target.model, latencyMs: performance.now() - started, success: true };
          return response;
        } catch (error) {
          lastError = error;
          this.telemetry.failures++;
          this.recordLatency(target.provider, performance.now() - started);
          const backoff = this.circuitBreaker.recordFailure(target.provider);
          if (!retryable(error, this.statuses) || retry === this.maxRetries) break;
          await new Promise<void>((resolve, reject) => {
            const timer = globalThis.setTimeout(resolve, backoff);
            request.signal?.addEventListener("abort", () => { globalThis.clearTimeout(timer); reject(request.signal?.reason ?? new Error("Operation aborted")); }, { once: true });
          });
        }
      }
      if (attemptedProvider) this.telemetry.fallbackCount++;
    }
    throw new Error(`All configured AI providers failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
  snapshot(): Readonly<FallbackTelemetry> { return structuredClone(this.telemetry); }
  private recordLatency(provider: string, durationMs: number): void {
    const current = this.telemetry.latencyMs[provider] ?? { attempts: 0, totalMs: 0, averageMs: 0 };
    const attempts = current.attempts + 1;
    const totalMs = current.totalMs + durationMs;
    this.telemetry.latencyMs[provider] = { attempts, totalMs, averageMs: totalMs / attempts };
  }
}

export { ProviderCircuitBreaker as CircuitBreaker };
