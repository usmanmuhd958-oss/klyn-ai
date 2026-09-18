export class ProviderCircuitOpenError extends Error {
    provider;
    retryAfterMs;
    retryable = true;
    constructor(provider, retryAfterMs) {
        super(`Provider circuit is open: ${provider}; retry after ${retryAfterMs}ms`);
        this.provider = provider;
        this.retryAfterMs = retryAfterMs;
        this.name = "ProviderCircuitOpenError";
    }
}
export class ProviderCircuitBreaker {
    states = new Map();
    failureThreshold;
    cooldownMs;
    maxBackoffMs;
    baseBackoffMs;
    constructor(options = {}) {
        this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
        this.cooldownMs = Math.max(1, options.cooldownMs ?? 30_000);
        this.maxBackoffMs = Math.max(this.cooldownMs, options.maxBackoffMs ?? 30_000);
        this.baseBackoffMs = Math.max(1, options.baseBackoffMs ?? 100);
    }
    canRequest(provider) {
        const state = this.states.get(provider);
        if (!state?.openedAt)
            return true;
        const elapsed = Date.now() - state.openedAt;
        if (elapsed >= this.cooldownMs) {
            state.halfOpen = true;
            return true;
        }
        return false;
    }
    assertRequestAllowed(provider) {
        if (!this.canRequest(provider)) {
            const state = this.states.get(provider);
            throw new ProviderCircuitOpenError(provider, Math.max(0, this.cooldownMs - (Date.now() - state.openedAt)));
        }
    }
    recordSuccess(provider) { this.states.delete(provider); }
    recordFailure(provider) {
        const state = this.states.get(provider) ?? { failures: 0, halfOpen: false };
        state.failures += 1;
        if (state.halfOpen || state.failures >= this.failureThreshold) {
            state.openedAt = Date.now();
            state.halfOpen = false;
        }
        this.states.set(provider, state);
        return Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** Math.max(0, state.failures - 1));
    }
    reset(provider) { if (provider)
        this.states.delete(provider);
    else
        this.states.clear(); }
    snapshot() {
        const result = {};
        for (const [provider, state] of this.states)
            result[provider] = { failures: state.failures, open: Boolean(state.openedAt && !this.canRequest(provider)) };
        return result;
    }
}
//# sourceMappingURL=circuit-breaker.js.map