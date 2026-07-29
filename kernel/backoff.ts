// ============================================================
// KLYN AI OS — Fault Tolerance: Exponential Backoff + Circuit Breaker
// Version: 2.0.0
//
// Features:
//   - Full jitter exponential backoff (AWS best-practice)
//   - Configurable attempt caps, base delay, max delay, jitter
//   - Circuit breaker: CLOSED → OPEN → HALF_OPEN → CLOSED
//   - Thread-safe state machine with probe-based recovery
//   - Global named circuit breaker registry
//   - withRetry() higher-order wrapper — async/sync compatible
//   - Per-attempt metadata for observability hooks
//   - Zero external dependencies
// ============================================================

'use strict';

const { EventEmitter } = require('events');

// ─── BACKOFF CALCULATOR ──────────────────────────────────────

/**
 * Compute full-jitter exponential backoff delay (ms).
 *
 * Formula: random_between(0, min(maxDelay, base * 2^attempt))
 *
 * @param {number} attempt     - Zero-indexed attempt number
 * @param {number} baseMs      - Base delay in ms (default 200)
 * @param {number} maxMs       - Maximum delay ceiling in ms (default 30 000)
 * @param {number} multiplier  - Exponential growth factor (default 2)
 * @returns {number} Delay in ms
 */
function computeBackoff(attempt, baseMs = 200, maxMs = 30_000, multiplier = 2) {
    if (attempt < 0) attempt = 0;

    const cap     = Math.min(maxMs, baseMs * Math.pow(multiplier, attempt));
    const jittered = Math.random() * cap;

    return Math.floor(jittered);
}

/**
 * Promisified sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── RETRY POLICY ────────────────────────────────────────────
const DEFAULT_RETRY_POLICY = Object.freeze({
    maxAttempts:  5,
    baseMs:       200,
    maxMs:        30_000,
    multiplier:   2,
    // Return true to retry, false to abort immediately (non-retriable error)
    isRetriable:  (_err) => true,
    onAttempt:    null,   // (attempt, delay, err) => void — observability hook
    onExhausted:  null,   // (attempts, lastErr) => void
    timeout:      null,   // Per-attempt timeout in ms (null = no timeout)
});

/**
 * Execute an async function with exponential backoff retry.
 *
 * @template T
 * @param {() => Promise<T>} fn   - The operation to retry
 * @param {Partial<DEFAULT_RETRY_POLICY>} policy
 * @returns {Promise<T>}
 */
async function withRetry(fn, policy: any = {}) {
    const cfg = { ...DEFAULT_RETRY_POLICY, ...policy };

    if (typeof fn !== 'function') {
        throw new TypeError('withRetry: first argument must be a function');
    }

    let lastErr;

    for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
        try {
            let result;

            if (cfg.timeout) {
                result = await Promise.race([
                    fn(),
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new RetryTimeoutError(`Attempt ${attempt + 1} timed out after ${cfg.timeout}ms`)),
                            cfg.timeout
                        )
                    ),
                ]);
            } else {
                result = await fn();
            }

            return result;

        } catch (err) {
            lastErr = err;

            // Check if error is retriable
            if (!cfg.isRetriable(err)) {
                throw err;
            }

            const isLastAttempt = attempt === cfg.maxAttempts - 1;

            if (isLastAttempt) break;

            const delayMs = computeBackoff(attempt, cfg.baseMs, cfg.maxMs, cfg.multiplier);

            if (typeof cfg.onAttempt === 'function') {
                try {
                    cfg.onAttempt(attempt + 1, delayMs, err);
                } catch (_) {}
            }

            await sleep(delayMs);
        }
    }

    if (typeof cfg.onExhausted === 'function') {
        try {
            cfg.onExhausted(cfg.maxAttempts, lastErr);
        } catch (_) {}
    }

    const wrapped = new RetryExhaustedError(
        `All ${cfg.maxAttempts} attempts failed. Last error: ${lastErr?.message}`,
        lastErr,
        cfg.maxAttempts
    );

    throw wrapped;
}

// ─── CUSTOM ERROR TYPES ──────────────────────────────────────
class RetryExhaustedError extends Error {
  [key: string]: any;
    constructor(message, cause, attempts) {
        super(message);
        this.name     = 'RetryExhaustedError';
        this.cause    = cause;
        this.attempts = attempts;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, RetryExhaustedError);
        }
    }
}

class RetryTimeoutError extends Error {
  [key: string]: any;
    constructor(message) {
        super(message);
        this.name = 'RetryTimeoutError';

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, RetryTimeoutError);
        }
    }
}

class CircuitOpenError extends Error {
  [key: string]: any;
    constructor(name, state, cooldownRemainingMs) {
        super(`Circuit '${name}' is ${state}. Cooldown remaining: ${cooldownRemainingMs}ms`);
        this.name                 = 'CircuitOpenError';
        this.circuitName          = name;
        this.circuitState         = state;
        this.cooldownRemainingMs  = cooldownRemainingMs;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, CircuitOpenError);
        }
    }
}

// ─── CIRCUIT BREAKER STATE MACHINE ───────────────────────────
const CB_STATE = Object.freeze({
    CLOSED:    'CLOSED',     // Normal operation
    OPEN:      'OPEN',       // Rejecting all calls
    HALF_OPEN: 'HALF_OPEN',  // Probing — single test call allowed
});

/**
 * @typedef {Object} CircuitBreakerOptions
 * @property {number}   [failureThreshold=5]       - Consecutive failures to OPEN
 * @property {number}   [successThreshold=2]       - Consecutive successes to re-CLOSE from HALF_OPEN
 * @property {number}   [cooldownMs=60000]         - OPEN → HALF_OPEN transition delay
 * @property {number}   [halfOpenProbeTimeoutMs=5000] - Probe call timeout
 * @property {Function} [isFailure]                - (err) => bool — custom failure classifier
 * @property {Function} [onStateChange]            - (name, prevState, newState, meta) => void
 */

class CircuitBreaker extends EventEmitter {
  [key: string]: any;
    #name;
    #state;
    #failureCount;
    #successCount;
    #lastFailureTime;
    #lastStateChange;
    #totalCalls;
    #totalFailures;
    #totalSuccesses;
    #totalRejections;
    #opts;

    constructor(name, options: any = {}) {
        super();

        if (!name || typeof name !== 'string') {
            throw new TypeError('CircuitBreaker: name must be a non-empty string');
        }

        this.#name  = name;
        this.#state = CB_STATE.CLOSED;
        this.#opts  = {
            failureThreshold:       options.failureThreshold       ?? 5,
            successThreshold:       options.successThreshold       ?? 2,
            cooldownMs:             options.cooldownMs             ?? 60_000,
            halfOpenProbeTimeoutMs: options.halfOpenProbeTimeoutMs ?? 5_000,
            isFailure:              options.isFailure              ?? (() => true),
            onStateChange:          options.onStateChange          ?? null,
        };

        // State counters
        this.#failureCount    = 0;
        this.#successCount    = 0;
        this.#lastFailureTime = null;
        this.#lastStateChange = Date.now();

        // Telemetry totals
        this.#totalCalls      = 0;
        this.#totalFailures   = 0;
        this.#totalSuccesses  = 0;
        this.#totalRejections = 0;
    }

    get name()  { return this.#name; }
    get state() { return this.#state; }

    // ── EXECUTE ──────────────────────────────────────────────
    async execute(fn) {
        this.#totalCalls++;

        // Check if OPEN circuit has cooled down → transition to HALF_OPEN
        if (this.#state === CB_STATE.OPEN) {
            const elapsed = Date.now() - this.#lastFailureTime;
            const remaining = this.#opts.cooldownMs - elapsed;

            if (remaining > 0) {
                this.#totalRejections++;
                throw new CircuitOpenError(this.#name, CB_STATE.OPEN, remaining);
            }

            // Cooldown expired → probe
            this.#transitionTo(CB_STATE.HALF_OPEN);
        }

        // HALF_OPEN: wrap with probe timeout
        const isProbe = this.#state === CB_STATE.HALF_OPEN;
        const effectiveFn = isProbe
            ? () => Promise.race([
                fn(),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new RetryTimeoutError(`Circuit probe timed out after ${this.#opts.halfOpenProbeTimeoutMs}ms`)),
                        this.#opts.halfOpenProbeTimeoutMs
                    )
                ),
            ])
            : fn;

        try {
            const result = await effectiveFn();
            this.#onSuccess();
            return result;
        } catch (err) {
            const isFailure = this.#opts.isFailure(err);

            if (isFailure) {
                this.#onFailure(err);
            } else {
                // Business error — not a circuit failure
                this.#totalSuccesses++;
            }

            throw err;
        }
    }

    // ── STATE TRANSITIONS ────────────────────────────────────
    #onSuccess() {
        this.#totalSuccesses++;
        this.#failureCount = 0;

        if (this.#state === CB_STATE.HALF_OPEN) {
            this.#successCount++;

            if (this.#successCount >= this.#opts.successThreshold) {
                this.#successCount = 0;
                this.#transitionTo(CB_STATE.CLOSED);
            }
        }
    }

    #onFailure(err) {
        this.#totalFailures++;
        this.#lastFailureTime = Date.now();
        this.#successCount    = 0;

        if (this.#state === CB_STATE.HALF_OPEN) {
            // Probe failed → back to OPEN
            this.#transitionTo(CB_STATE.OPEN);
            return;
        }

        this.#failureCount++;

        if (
            this.#state === CB_STATE.CLOSED &&
            this.#failureCount >= this.#opts.failureThreshold
        ) {
            this.#transitionTo(CB_STATE.OPEN);
        }
    }

    #transitionTo(newState) {
        if (this.#state === newState) return;

        const prevState = this.#state;
        this.#state     = newState;
        this.#lastStateChange = Date.now();

        if (newState === CB_STATE.CLOSED) {
            this.#failureCount = 0;
            this.#successCount = 0;
        }

        const meta = { failureCount: this.#failureCount, totalCalls: this.#totalCalls };

        this.emit('state-change', {
            name: this.#name,
            from: prevState,
            to:   newState,
            meta,
        });

        if (typeof this.#opts.onStateChange === 'function') {
            try {
                this.#opts.onStateChange(this.#name, prevState, newState, meta);
            } catch (_) {}
        }
    }

    // ── FORCED CONTROL ───────────────────────────────────────
    forceOpen() {
        this.#lastFailureTime = Date.now();
        this.#transitionTo(CB_STATE.OPEN);
    }

    forceClose() {
        this.#transitionTo(CB_STATE.CLOSED);
    }

    reset() {
        this.#failureCount    = 0;
        this.#successCount    = 0;
        this.#lastFailureTime = null;
        this.#transitionTo(CB_STATE.CLOSED);
    }

    // ── STATISTICS ───────────────────────────────────────────
    getStats() {
        return {
            name:              this.#name,
            state:             this.#state,
            failureCount:      this.#failureCount,
            successCount:      this.#successCount,
            lastFailureTime:   this.#lastFailureTime,
            lastStateChange:   this.#lastStateChange,
            uptime:            Date.now() - this.#lastStateChange,
            totals: {
                calls:      this.#totalCalls,
                successes:  this.#totalSuccesses,
                failures:   this.#totalFailures,
                rejections: this.#totalRejections,
            },
            config: {
                failureThreshold: this.#opts.failureThreshold,
                successThreshold: this.#opts.successThreshold,
                cooldownMs:       this.#opts.cooldownMs,
            },
        };
    }
}

// ─── CIRCUIT BREAKER REGISTRY ────────────────────────────────
class CircuitBreakerRegistry {
  [key: string]: any;
    #breakers;

    constructor() {
        this.#breakers = new Map();
    }

    /**
     * Get or create a named circuit breaker.
     */
    get(name, options: any = {}) {
        if (!this.#breakers.has(name)) {
            this.#breakers.set(name, new CircuitBreaker(name, options));
        }
        return this.#breakers.get(name);
    }

    /**
     * Get all circuit breaker stats as a plain object.
     */
    getAll() {
        const result = {};
        for (const [name, cb] of this.#breakers) {
            result[name] = cb.getStats();
        }
        return result;
    }

    /**
     * Reset all breakers to CLOSED.
     */
    resetAll() {
        for (const cb of this.#breakers.values()) {
            cb.reset();
        }
    }

    has(name) {
        return this.#breakers.has(name);
    }

    delete(name) {
        return this.#breakers.delete(name);
    }

    get size() {
        return this.#breakers.size;
    }
}

// ─── SINGLETON GLOBAL REGISTRY ───────────────────────────────
const registry = new CircuitBreakerRegistry();

// ─── CONVENIENCE: withCircuit ─────────────────────────────────
/**
 * Execute fn through a named circuit breaker.
 *
 * @param {string} name
 * @param {() => Promise<any>} fn
 * @param {object} [cbOptions]
 */
async function withCircuit(name, fn, cbOptions = {}) {
    const cb = registry.get(name, cbOptions);
    return cb.execute(fn);
}

/**
 * Execute fn with both retry and circuit breaker protection.
 * Circuit applies per-attempt; retry wraps the whole circuit call.
 *
 * @param {string}        circuitName
 * @param {() => Promise} fn
 * @param {object}        [retryPolicy]
 * @param {object}        [cbOptions]
 */
async function withRetryAndCircuit(circuitName, fn, retryPolicy = {}, cbOptions = {}) {
    const cb = registry.get(circuitName, cbOptions);

    return withRetry(
        () => cb.execute(fn),
        {
            ...retryPolicy,
            isRetriable: (err) => {
                // Never retry if circuit is OPEN
                if (err instanceof CircuitOpenError) return false;
                // @ts-ignore
                return retryPolicy.isRetriable ? retryPolicy.isRetriable(err) : true;
            },
        }
    );
}

// ─── EXPORTS ─────────────────────────────────────────────────
module.exports = {
    // Backoff primitives
    computeBackoff,
    sleep,
    withRetry,

    // Circuit breaker
    CircuitBreaker,
    CircuitBreakerRegistry,
    CB_STATE,

    // Global registry
    registry,

    // High-level wrappers
    withCircuit,
    withRetryAndCircuit,

    // Error types
    RetryExhaustedError,
    RetryTimeoutError,
    CircuitOpenError,
};


export {};
