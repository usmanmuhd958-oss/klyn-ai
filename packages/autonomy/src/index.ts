export type AutonomyRisk = "low" | "medium" | "high";

export interface UsageMetrics {
  readonly tokens: number;
  readonly computeMillis: number;
  readonly networkRequests: number;
  readonly financialSpendMinorUnits: bigint;
  readonly toolInvocations: number;
  readonly wallClockMillis: number;
}

export interface BudgetLimits extends UsageMetrics {}

export interface BudgetThresholds {
  readonly tokens: number;
  readonly computeMillis: number;
  readonly networkRequests: number;
  readonly financialSpendMinorUnits: number;
  readonly toolInvocations: number;
  readonly wallClockMillis: number;
}

export interface AutonomyBudgetEnvelope {
  readonly schemaVersion: number;
  readonly missionId: string;
  readonly agentId: string;
  readonly principalId: string;
  readonly policyVersion: string;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly limits: BudgetLimits;
  readonly warningThresholds: BudgetThresholds;
  readonly escalationThresholds: BudgetThresholds;
  readonly allowedTools: readonly string[];
  readonly maxRisk: AutonomyRisk;
  readonly maxDelegationDepth: number;
}

export type ContainmentLevel = "ok" | "warning" | "escalated" | "terminated";

export interface ContainmentDecision {
  readonly level: ContainmentLevel;
  readonly exceeded: readonly (keyof UsageMetrics)[];
  readonly warning: readonly (keyof UsageMetrics)[];
  readonly usage: UsageMetrics;
  readonly recordedAtEpochMs: number;
}

export class AutonomyContainmentError extends Error {
  public readonly decision: ContainmentDecision;

  public constructor(decision: ContainmentDecision) {
    super(`Autonomy budget containment triggered: ${decision.exceeded.join(", ") || decision.level}`);
    this.name = "AutonomyContainmentError";
    this.decision = decision;
  }
}

function ratio(used: number | bigint, limit: number | bigint): number {
  if (typeof used === "bigint" || typeof limit === "bigint") {
    const usedBig = BigInt(used);
    const limitBig = BigInt(limit);
    if (limitBig === 0n) return usedBig > 0n ? Number.POSITIVE_INFINITY : 0;
    return Number(usedBig) / Number(limitBig);
  }
  if (limit === 0) return used > 0 ? Number.POSITIVE_INFINITY : 0;
  return used / limit;
}

function addUsage(a: UsageMetrics, b: UsageMetrics): UsageMetrics {
  return Object.freeze({
    tokens: a.tokens + b.tokens,
    computeMillis: a.computeMillis + b.computeMillis,
    networkRequests: a.networkRequests + b.networkRequests,
    financialSpendMinorUnits: a.financialSpendMinorUnits + b.financialSpendMinorUnits,
    toolInvocations: a.toolInvocations + b.toolInvocations,
    wallClockMillis: a.wallClockMillis + b.wallClockMillis,
  });
}

function validateDelta(delta: UsageMetrics): void {
  const numeric: Array<[keyof UsageMetrics, number]> = [
    ["tokens", delta.tokens],
    ["computeMillis", delta.computeMillis],
    ["networkRequests", delta.networkRequests],
    ["toolInvocations", delta.toolInvocations],
    ["wallClockMillis", delta.wallClockMillis],
  ];
  for (const [field, value] of numeric) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${String(field)} must be a non-negative safe integer`);
  }
  if (typeof delta.financialSpendMinorUnits !== "bigint" || delta.financialSpendMinorUnits < 0n) {
    throw new RangeError("financialSpendMinorUnits must be a non-negative bigint");
  }
}

const USAGE_FIELDS: readonly (keyof UsageMetrics)[] = [
  "tokens",
  "computeMillis",
  "networkRequests",
  "financialSpendMinorUnits",
  "toolInvocations",
  "wallClockMillis",
];

export class BudgetLedger {
  private usage: UsageMetrics = Object.freeze({
    tokens: 0,
    computeMillis: 0,
    networkRequests: 0,
    financialSpendMinorUnits: 0n,
    toolInvocations: 0,
    wallClockMillis: 0,
  });
  private terminated = false;

  public constructor(public readonly envelope: AutonomyBudgetEnvelope) {
    if (envelope.expiresAtEpochMs <= envelope.issuedAtEpochMs) {
      throw new RangeError("budget expiry must be after issue time");
    }
  }

  public consume(delta: UsageMetrics, nowEpochMs = Date.now()): ContainmentDecision {
    validateDelta(delta);
    if (this.terminated) {
      const decision = this.decision("terminated", [], [], nowEpochMs);
      throw new AutonomyContainmentError(decision);
    }

    this.usage = addUsage(this.usage, delta);
    const warning = USAGE_FIELDS.filter((field) => ratio(this.usage[field], this.envelope.limits[field]) >= this.envelope.warningThresholds[field]);
    const escalated = USAGE_FIELDS.filter((field) => ratio(this.usage[field], this.envelope.limits[field]) >= this.envelope.escalationThresholds[field]);
    const exceeded = USAGE_FIELDS.filter((field) => {
      const used = this.usage[field];
      const limit = this.envelope.limits[field];
      return typeof used === "bigint" ? used > BigInt(limit) : used > limit;
    });

    if (exceeded.length > 0) {
      this.terminated = true;
      const decision = this.decision("terminated", warning, exceeded, nowEpochMs);
      throw new AutonomyContainmentError(decision);
    }

    const level: ContainmentLevel = escalated.length > 0 ? "escalated" : warning.length > 0 ? "warning" : "ok";
    return this.decision(level, warning, [], nowEpochMs);
  }

  public snapshot(): { readonly usage: UsageMetrics; readonly terminated: boolean } {
    return Object.freeze({
      usage: this.usage,
      terminated: this.terminated,
    });
  }

  public isTerminated(): boolean {
    return this.terminated;
  }

  private decision(
    level: ContainmentLevel,
    warning: readonly (keyof UsageMetrics)[],
    exceeded: readonly (keyof UsageMetrics)[],
    recordedAtEpochMs: number,
  ): ContainmentDecision {
    return Object.freeze({
      level,
      warning: Object.freeze([...warning]),
      exceeded: Object.freeze([...exceeded]),
      usage: this.usage,
      recordedAtEpochMs,
    });
  }
}

export interface RealTimeContainmentInterceptorOptions {
  readonly onDecision?: (decision: ContainmentDecision) => void | Promise<void>;
}

export class RealTimeContainmentInterceptor {
  public constructor(
    private readonly ledger: BudgetLedger,
    private readonly options: RealTimeContainmentInterceptorOptions = {},
  ) {}

  public async intercept(delta: UsageMetrics, nowEpochMs = Date.now()): Promise<ContainmentDecision> {
    try {
      const decision = this.ledger.consume(delta, nowEpochMs);
      await this.options.onDecision?.(decision);
      return decision;
    } catch (error) {
      if (error instanceof AutonomyContainmentError) {
        await this.options.onDecision?.(error.decision);
      }
      throw error;
    }
  }

  public isTerminated(): boolean {
    return this.ledger.isTerminated();
  }
}
