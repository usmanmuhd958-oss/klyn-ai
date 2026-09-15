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
    for (let index = 0; index < this.providers.length; index++) {
      const target = this.providers[index];
      if (request.model && target.model !== request.model) continue;
      if (!this.circuitBreaker.canRequest(target.provider)) { this.telemetry.fallbackCount++; continue; }
      for (let retry = 0; retry <= this.maxRetries; retry++) {
        const started = performance.now();
        this.telemetry.attempts++;
        this.telemetry.providerAttempts[target.provider] = (this.telemetry.providerAttempts[target.provider] ?? 0) + 1;
        try {
          const response = await target.adapter.generate({ ...request, model: target.model });
          const latencyMs = performance.now() - started;
          this.circuitBreaker.recordSuccess(target.provider);
          this.telemetry.successes++;
          this.recordLatency(target.provider, latencyMs);
          this.telemetry.lastAttempt = { provider: target.provider, model: target.model, latencyMs, success: true };
          return response;
        } catch (error) {
          lastError = error;
          this.telemetry.failures++;
          this.recordLatency(target.provider, performance.now() - started);
          const backoff = this.circuitBreaker.recordFailure(target.provider);
          if (!retryable(error, this.statuses) || retry === this.maxRetries) break;
          await this.sleep(backoff, request.signal);
        }
      }
      if (index < this.providers.length - 1) this.telemetry.fallbackCount++;
    }
    throw new Error(`All configured AI providers failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
  snapshot(): Readonly<FallbackTelemetry> { return structuredClone(this.telemetry); }
  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!ms) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = globalThis.setTimeout(() => { if (settled) return; settled = true; signal?.removeEventListener("abort", abort); resolve(); }, ms);
      const abort = () => { if (settled) return; settled = true; globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new Error("Operation aborted")); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  private recordLatency(provider: string, durationMs: number): void {
    const current = this.telemetry.latencyMs[provider] ?? { attempts: 0, totalMs: 0, averageMs: 0 };
    const attempts = current.attempts + 1;
    const totalMs = current.totalMs + durationMs;
    this.telemetry.latencyMs[provider] = { attempts, totalMs, averageMs: totalMs / attempts };
  }
}
export { ProviderCircuitBreaker as CircuitBreaker };
