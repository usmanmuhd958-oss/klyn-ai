export const AUTONOMY_SCHEMA_VERSION = 1 as const;

export type AutonomyRiskLevel = "low" | "medium" | "high" | "critical";

export interface BudgetLimits {
  readonly tokens: number;
  readonly computeMillis: number;
  readonly networkRequests: number;
  readonly financialSpendMinorUnits: bigint;
  readonly toolInvocations: number;
  readonly wallClockMillis: number;
}

export interface BudgetWarningThresholds {
  readonly tokens: number;
  readonly computeMillis: number;
  readonly networkRequests: number;
  readonly financialSpendMinorUnits: number;
  readonly toolInvocations: number;
  readonly wallClockMillis: number;
}

export interface AutonomyToolPermission {
  readonly toolName: string;
  readonly operations: readonly string[];
  readonly maxRisk: AutonomyRiskLevel;
}

export interface AutonomyEnvelope {
  readonly schemaVersion: typeof AUTONOMY_SCHEMA_VERSION;
  readonly missionId: string;
  readonly agentId: string;
  readonly principalId: string;
  readonly policyVersion: string;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly limits: BudgetLimits;
  readonly warningThresholds: BudgetWarningThresholds;
  readonly allowedTools: readonly AutonomyToolPermission[];
  readonly maxRisk: AutonomyRiskLevel;
  readonly maxDelegationDepth: number;
}

export interface UsageMetrics {
  readonly tokens: number;
  readonly computeMillis: number;
  readonly networkRequests: number;
  readonly financialSpendMinorUnits: bigint;
  readonly toolInvocations: number;
  readonly wallClockMillis: number;
}

export interface BudgetUsageSnapshot {
  readonly sequence: number;
  readonly usage: UsageMetrics;
  readonly remaining: UsageMetrics;
  readonly exhaustedDimensions: readonly string[];
  readonly terminated: boolean;
}

export type ContainmentAction = "CONTINUE" | "WARN" | "ESCALATE" | "TERMINATE";

export interface ContainmentDecision {
  readonly action: ContainmentAction;
  readonly reason: string;
  readonly breachedDimensions: readonly string[];
  readonly usage: UsageMetrics;
  readonly remaining: UsageMetrics;
  readonly sequence: number;
  readonly evaluatedAtEpochMs: number;
}

export interface BudgetAdmission {
  readonly admitted: boolean;
  readonly reason: string;
  readonly projectedUsage: UsageMetrics;
  readonly remaining: UsageMetrics;
  readonly evaluatedAtEpochMs: number;
}
