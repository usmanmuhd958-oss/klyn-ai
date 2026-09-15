export interface CircuitBreakerOptions {
  readonly failureThreshold?: number;
  readonly cooldownMs?: number;
  readonly maxBackoffMs?: number;
  readonly baseBackoffMs?: number;
}

interface CircuitState { failures: number; openedAt?: number; halfOpen: boolean; }

export class ProviderCircuitOpenError extends Error {
  readonly retryable = true;
  constructor(readonly provider: string, readonly retryAfterMs: number) {
    super(`Provider circuit is open: ${provider}; retry after ${retryAfterMs}ms`);
    this.name = "ProviderCircuitOpenError";
  }
}

export class ProviderCircuitBreaker {
  private readonly states = new Map<string, CircuitState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly maxBackoffMs: number;
  private readonly baseBackoffMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(1, options.cooldownMs ?? 30_000);
    this.maxBackoffMs = Math.max(this.cooldownMs, options.maxBackoffMs ?? 30_000);
    this.baseBackoffMs = Math.max(1, options.baseBackoffMs ?? 100);
  }

  canRequest(provider: string): boolean {
    const state = this.states.get(provider);
    if (!state?.openedAt) return true;
    const elapsed = Date.now() - state.openedAt;
    if (elapsed >= this.cooldownMs) { state.halfOpen = true; return true; }
    return false;
  }

  assertRequestAllowed(provider: string): void {
    if (!this.canRequest(provider)) {
      const state = this.states.get(provider)!;
      throw new ProviderCircuitOpenError(provider, Math.max(0, this.cooldownMs - (Date.now() - state.openedAt!)));
    }
  }

  recordSuccess(provider: string): void { this.states.delete(provider); }

  recordFailure(provider: string): number {
    const state = this.states.get(provider) ?? { failures: 0, halfOpen: false };
    state.failures += 1;
    if (state.halfOpen || state.failures >= this.failureThreshold) { state.openedAt = Date.now(); state.halfOpen = false; }
    this.states.set(provider, state);
    return Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** Math.max(0, state.failures - 1));
  }

  reset(provider?: string): void { if (provider) this.states.delete(provider); else this.states.clear(); }

  snapshot(): Readonly<Record<string, { failures: number; open: boolean }>> {
    const result: Record<string, { failures: number; open: boolean }> = {};
    for (const [provider, state] of this.states) result[provider] = { failures: state.failures, open: Boolean(state.openedAt && !this.canRequest(provider)) };
    return result;
  }
}
