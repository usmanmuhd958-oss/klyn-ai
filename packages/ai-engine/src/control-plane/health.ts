import type { ProviderHealthPolicy, ProviderHealthSnapshot, ProviderHealthState } from "./types.js";

interface MutableHealth {
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  latencySamples: number;
  averageLatencyMs?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  retryAfterAt?: number;
  state: ProviderHealthState;
}

const DEFAULT_POLICY: ProviderHealthPolicy = {
  failureThreshold: 3,
  recoveryCooldownMs: 30_000,
  degradedLatencyMs: 2_500,
};

export class ProviderHealthTracker {
  private readonly records = new Map<string, MutableHealth>();
  private readonly policy: ProviderHealthPolicy;

  constructor(policy: Partial<ProviderHealthPolicy> = {}) {
    this.policy = {
      failureThreshold: policy.failureThreshold ?? DEFAULT_POLICY.failureThreshold,
      recoveryCooldownMs: policy.recoveryCooldownMs ?? DEFAULT_POLICY.recoveryCooldownMs,
      degradedLatencyMs: policy.degradedLatencyMs ?? DEFAULT_POLICY.degradedLatencyMs,
    };
    if (!Number.isInteger(this.policy.failureThreshold) || this.policy.failureThreshold < 1) throw new Error("failureThreshold must be a positive integer");
    if (!Number.isFinite(this.policy.recoveryCooldownMs) || this.policy.recoveryCooldownMs < 1) throw new Error("recoveryCooldownMs must be positive");
    if (!Number.isFinite(this.policy.degradedLatencyMs) || this.policy.degradedLatencyMs <= 0) throw new Error("degradedLatencyMs must be positive");
  }

  ensure(providerId: string): ProviderHealthSnapshot {
    const current = this.records.get(providerId) ?? this.create(providerId);
    if (current.state === "unavailable" && current.retryAfterAt !== undefined && Date.now() >= current.retryAfterAt) {
      current.state = "unknown";
      current.retryAfterAt = undefined;
    }
    return this.snapshot(providerId, current);
  }

  recordSuccess(providerId: string, latencyMs: number, now = Date.now()): ProviderHealthSnapshot {
    const record = this.records.get(providerId) ?? this.create(providerId);
    record.totalSuccesses += 1;
    record.consecutiveFailures = 0;
    record.lastSuccessAt = now;
    record.retryAfterAt = undefined;
    record.latencySamples += 1;
    record.averageLatencyMs = record.averageLatencyMs === undefined
      ? latencyMs
      : record.averageLatencyMs + (latencyMs - record.averageLatencyMs) / record.latencySamples;
    record.state = record.averageLatencyMs > this.policy.degradedLatencyMs ? "degraded" : "healthy";
    return this.snapshot(providerId, record);
  }

  recordFailure(providerId: string, retryable: boolean, now = Date.now()): ProviderHealthSnapshot {
    const record = this.records.get(providerId) ?? this.create(providerId);
    record.totalFailures += 1;
    record.consecutiveFailures += 1;
    record.lastFailureAt = now;
    if (!retryable) {
      record.state = "degraded";
      return this.snapshot(providerId, record);
    }
    if (record.consecutiveFailures >= this.policy.failureThreshold) {
      record.state = "unavailable";
      record.retryAfterAt = now + this.policy.recoveryCooldownMs;
    } else {
      record.state = "rate-limited";
    }
    return this.snapshot(providerId, record);
  }

  markRateLimited(providerId: string, retryAfterAt?: number, now = Date.now()): ProviderHealthSnapshot {
    const record = this.records.get(providerId) ?? this.create(providerId);
    record.state = "rate-limited";
    record.lastFailureAt = now;
    record.retryAfterAt = retryAfterAt ?? now + this.policy.recoveryCooldownMs;
    return this.snapshot(providerId, record);
  }

  canAttempt(providerId: string, now = Date.now()): boolean {
    const record = this.records.get(providerId);
    if (!record) return true;
    if (record.state !== "unavailable" && record.state !== "rate-limited") return true;
    if (record.retryAfterAt === undefined || now >= record.retryAfterAt) {
      record.state = "unknown";
      record.retryAfterAt = undefined;
      return true;
    }
    return false;
  }

  snapshotAll(): readonly ProviderHealthSnapshot[] {
    return [...this.records.keys()].sort().map((providerId) => this.ensure(providerId));
  }

  snapshot(providerId: string, record = this.records.get(providerId)): ProviderHealthSnapshot {
    const current = record ?? this.create(providerId);
    return Object.freeze({
      providerId,
      state: current.state,
      consecutiveFailures: current.consecutiveFailures,
      totalSuccesses: current.totalSuccesses,
      totalFailures: current.totalFailures,
      averageLatencyMs: current.averageLatencyMs,
      lastSuccessAt: current.lastSuccessAt,
      lastFailureAt: current.lastFailureAt,
      retryAfterAt: current.retryAfterAt,
    });
  }

  private create(providerId: string): MutableHealth {
    const record: MutableHealth = {
      consecutiveFailures: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      latencySamples: 0,
      state: "unknown",
    };
    this.records.set(providerId, record);
    return record;
  }
}
