import type {
  AutonomyEnvelope,
  BudgetAdmission,
  BudgetLimits,
  BudgetUsageSnapshot,
  ContainmentDecision,
  UsageMetrics,
} from "./types.js";

const ZERO_USAGE: UsageMetrics = Object.freeze({
  tokens: 0,
  computeMillis: 0,
  networkRequests: 0,
  financialSpendMinorUnits: 0n,
  toolInvocations: 0,
  wallClockMillis: 0,
});

function assertNonNegativeFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(field + " must be a finite non-negative number");
  }
}

function validateLimits(limits: BudgetLimits): void {
  assertNonNegativeFinite(limits.tokens, "limits.tokens");
  assertNonNegativeFinite(limits.computeMillis, "limits.computeMillis");
  assertNonNegativeFinite(limits.networkRequests, "limits.networkRequests");
  assertNonNegativeFinite(limits.toolInvocations, "limits.toolInvocations");
  assertNonNegativeFinite(limits.wallClockMillis, "limits.wallClockMillis");
  if (limits.financialSpendMinorUnits < 0n) {
    throw new RangeError("limits.financialSpendMinorUnits must be non-negative");
  }
}

function validateUsage(usage: UsageMetrics): void {
  assertNonNegativeFinite(usage.tokens, "usage.tokens");
  assertNonNegativeFinite(usage.computeMillis, "usage.computeMillis");
  assertNonNegativeFinite(usage.networkRequests, "usage.networkRequests");
  assertNonNegativeFinite(usage.toolInvocations, "usage.toolInvocations");
  assertNonNegativeFinite(usage.wallClockMillis, "usage.wallClockMillis");
  if (usage.financialSpendMinorUnits < 0n) {
    throw new RangeError("usage.financialSpendMinorUnits must be non-negative");
  }
}

function addUsage(left: UsageMetrics, right: UsageMetrics): UsageMetrics {
  return Object.freeze({
    tokens: left.tokens + right.tokens,
    computeMillis: left.computeMillis + right.computeMillis,
    networkRequests: left.networkRequests + right.networkRequests,
    financialSpendMinorUnits: left.financialSpendMinorUnits + right.financialSpendMinorUnits,
    toolInvocations: left.toolInvocations + right.toolInvocations,
    wallClockMillis: left.wallClockMillis + right.wallClockMillis,
  });
}

function subtractUsage(limit: BudgetLimits, usage: UsageMetrics): UsageMetrics {
  return Object.freeze({
    tokens: Math.max(0, limit.tokens - usage.tokens),
    computeMillis: Math.max(0, limit.computeMillis - usage.computeMillis),
    networkRequests: Math.max(0, limit.networkRequests - usage.networkRequests),
    financialSpendMinorUnits: limit.financialSpendMinorUnits > usage.financialSpendMinorUnits
      ? limit.financialSpendMinorUnits - usage.financialSpendMinorUnits
      : 0n,
    toolInvocations: Math.max(0, limit.toolInvocations - usage.toolInvocations),
    wallClockMillis: Math.max(0, limit.wallClockMillis - usage.wallClockMillis),
  });
}

function exceededDimensions(limits: BudgetLimits, usage: UsageMetrics): string[] {
  const exceeded: string[] = [];
  if (usage.tokens > limits.tokens) exceeded.push("tokens");
  if (usage.computeMillis > limits.computeMillis) exceeded.push("computeMillis");
  if (usage.networkRequests > limits.networkRequests) exceeded.push("networkRequests");
  if (usage.financialSpendMinorUnits > limits.financialSpendMinorUnits) exceeded.push("financialSpendMinorUnits");
  if (usage.toolInvocations > limits.toolInvocations) exceeded.push("toolInvocations");
  if (usage.wallClockMillis > limits.wallClockMillis) exceeded.push("wallClockMillis");
  return exceeded;
}

function numberAtOrAboveThreshold(usage: number, limit: number, threshold: number): boolean {
  if (limit === 0) return usage > 0;
  return usage / limit >= threshold;
}

function bigintAtOrAboveThreshold(usage: bigint, limit: bigint, threshold: number): boolean {
  if (limit === 0n) return usage > 0n;
  const scale = 1_000_000n;
  const thresholdScaled = BigInt(Math.ceil(threshold * Number(scale)));
  return usage * scale >= limit * thresholdScaled;
}

export class BudgetLedger {
  private usage: UsageMetrics = ZERO_USAGE;
  private sequence = 0;
  private terminated = false;

  public constructor(private readonly envelope: AutonomyEnvelope) {
    if (envelope.schemaVersion !== 1) throw new RangeError("unsupported autonomy envelope schema version");
    if (!envelope.missionId.trim()) throw new RangeError("missionId is required");
    if (!envelope.agentId.trim()) throw new RangeError("agentId is required");
    if (!envelope.principalId.trim()) throw new RangeError("principalId is required");
    if (!envelope.policyVersion.trim()) throw new RangeError("policyVersion is required");
    if (!Number.isFinite(envelope.issuedAtEpochMs) || !Number.isFinite(envelope.expiresAtEpochMs)) {
      throw new RangeError("envelope timestamps must be finite");
    }
    if (envelope.expiresAtEpochMs <= envelope.issuedAtEpochMs) {
      throw new RangeError("envelope expiry must be after issue time");
    }
    if (!Number.isInteger(envelope.maxDelegationDepth) || envelope.maxDelegationDepth < 0) {
      throw new RangeError("maxDelegationDepth must be a non-negative integer");
    }
    validateLimits(envelope.limits);
    for (const [name, value] of Object.entries(envelope.warningThresholds)) {
      assertNonNegativeFinite(value, "warningThresholds." + name);
      if (value > 1) throw new RangeError("warningThresholds." + name + " must be <= 1");
    }
  }

  public get missionId(): string {
    return this.envelope.missionId;
  }

  public get envelopeSnapshot(): AutonomyEnvelope {
    return this.envelope;
  }

  public isTerminated(): boolean {
    return this.terminated;
  }

  public snapshot(): BudgetUsageSnapshot {
    return Object.freeze({
      sequence: this.sequence,
      usage: this.usage,
      remaining: subtractUsage(this.envelope.limits, this.usage),
      exhaustedDimensions: Object.freeze(exceededDimensions(this.envelope.limits, this.usage)),
      terminated: this.terminated,
    });
  }

  public admit(estimate: UsageMetrics, nowEpochMs = Date.now()): BudgetAdmission {
    validateUsage(estimate);

    if (this.terminated) {
      return Object.freeze({
        admitted: false,
        reason: "autonomy ledger is terminated",
        projectedUsage: addUsage(this.usage, estimate),
        remaining: subtractUsage(this.envelope.limits, this.usage),
        evaluatedAtEpochMs: nowEpochMs,
      });
    }

    if (nowEpochMs >= this.envelope.expiresAtEpochMs) {
      this.terminated = true;
      return Object.freeze({
        admitted: false,
        reason: "autonomy envelope is expired",
        projectedUsage: addUsage(this.usage, estimate),
        remaining: subtractUsage(this.envelope.limits, this.usage),
        evaluatedAtEpochMs: nowEpochMs,
      });
    }

    const projectedUsage = addUsage(this.usage, estimate);
    const exceeded = exceededDimensions(this.envelope.limits, projectedUsage);
    return Object.freeze({
      admitted: exceeded.length === 0,
      reason: exceeded.length === 0 ? "within autonomy envelope" : "admission exceeds " + exceeded.join(", "),
      projectedUsage,
      remaining: subtractUsage(this.envelope.limits, this.usage),
      evaluatedAtEpochMs: nowEpochMs,
    });
  }

  public record(delta: UsageMetrics, nowEpochMs = Date.now()): ContainmentDecision {
    validateUsage(delta);

    if (this.terminated) {
      return Object.freeze({
        action: "TERMINATE",
        reason: "autonomy ledger is already terminated",
        breachedDimensions: Object.freeze(["ledger"]),
        usage: this.usage,
        remaining: subtractUsage(this.envelope.limits, this.usage),
        sequence: this.sequence,
        evaluatedAtEpochMs: nowEpochMs,
      });
    }

    this.usage = addUsage(this.usage, delta);
    this.sequence += 1;

    if (nowEpochMs >= this.envelope.expiresAtEpochMs) {
      this.terminated = true;
      return Object.freeze({
        action: "TERMINATE",
        reason: "autonomy envelope expired during execution",
        breachedDimensions: Object.freeze(["envelopeExpiry"]),
        usage: this.usage,
        remaining: subtractUsage(this.envelope.limits, this.usage),
        sequence: this.sequence,
        evaluatedAtEpochMs: nowEpochMs,
      });
    }

    const exceeded = exceededDimensions(this.envelope.limits, this.usage);
    if (exceeded.length > 0) {
      this.terminated = true;
      return Object.freeze({
        action: "TERMINATE",
        reason: "autonomy hard budget breached",
        breachedDimensions: Object.freeze(exceeded),
        usage: this.usage,
        remaining: subtractUsage(this.envelope.limits, this.usage),
        sequence: this.sequence,
        evaluatedAtEpochMs: nowEpochMs,
      });
    }

    const warningChecks: Array<[string, number, number, number]> = [
      ["tokens", this.usage.tokens, this.envelope.limits.tokens, this.envelope.warningThresholds.tokens],
      ["computeMillis", this.usage.computeMillis, this.envelope.limits.computeMillis, this.envelope.warningThresholds.computeMillis],
      ["networkRequests", this.usage.networkRequests, this.envelope.limits.networkRequests, this.envelope.warningThresholds.networkRequests],
      ["toolInvocations", this.usage.toolInvocations, this.envelope.limits.toolInvocations, this.envelope.warningThresholds.toolInvocations],
      ["wallClockMillis", this.usage.wallClockMillis, this.envelope.limits.wallClockMillis, this.envelope.warningThresholds.wallClockMillis],
    ];

    const warningDimensions = warningChecks
      .filter(([, used, limit, threshold]) => numberAtOrAboveThreshold(used, limit, threshold))
      .map(([name]) => name);

    if (bigintAtOrAboveThreshold(
      this.usage.financialSpendMinorUnits,
      this.envelope.limits.financialSpendMinorUnits,
      this.envelope.warningThresholds.financialSpendMinorUnits,
    )) {
      warningDimensions.push("financialSpendMinorUnits");
    }

    if (warningDimensions.length > 0) {
      return Object.freeze({
        action: "WARN",
        reason: "autonomy budget warning threshold reached",
        breachedDimensions: Object.freeze(warningDimensions),
        usage: this.usage,
        remaining: subtractUsage(this.envelope.limits, this.usage),
        sequence: this.sequence,
        evaluatedAtEpochMs: nowEpochMs,
      });
    }

    return Object.freeze({
      action: "CONTINUE",
      reason: "usage remains within autonomy envelope",
      breachedDimensions: Object.freeze([]),
      usage: this.usage,
      remaining: subtractUsage(this.envelope.limits, this.usage),
      sequence: this.sequence,
      evaluatedAtEpochMs: nowEpochMs,
    });
  }

  public terminate(reason: string, nowEpochMs = Date.now()): ContainmentDecision {
    if (!reason.trim()) throw new RangeError("termination reason is required");
    this.terminated = true;
    return Object.freeze({
      action: "TERMINATE",
      reason,
      breachedDimensions: Object.freeze(["operator"]),
      usage: this.usage,
      remaining: subtractUsage(this.envelope.limits, this.usage),
      sequence: this.sequence,
      evaluatedAtEpochMs: nowEpochMs,
    });
  }
}
