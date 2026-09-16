import { createHash } from "node:crypto";
import type { IntentSpec, RiskLevel } from "./IntentSpec.js";
import type { EpistemicAuditRecord } from "./EpistemicAuditEngine.js";

export type GovernanceRiskVector = "SECURITY_POSTURE" | "DESTRUCTIVE_SCOPE" | "DEPENDENCY_BOUNDARY" | "BREAKING_API_SURFACE";
export type GovernanceSeverity = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface GovernanceRiskInput {
  readonly securityPosture: GovernanceSeverity;
  readonly destructiveOperationalScope: GovernanceSeverity;
  readonly dependencyBoundary: GovernanceSeverity;
  readonly breakingApiSurface: GovernanceSeverity;
}

export interface GovernanceViolation {
  readonly vector: GovernanceRiskVector;
  readonly severity: Exclude<GovernanceSeverity, "NONE">;
  readonly reason: string;
}

export interface GovernanceConsensusInput {
  readonly disposition: "ACCEPT" | "REJECT" | "UNRESOLVED";
  readonly weightedSupport: number;
  readonly weightedOpposition: number;
  readonly quorum: number;
}

export interface GovernanceEvaluation {
  readonly intentId: string;
  readonly auditState: EpistemicAuditRecord["state"];
  readonly proofDigest: string;
  readonly riskLevel: RiskLevel;
  readonly risks: Readonly<Record<GovernanceRiskVector, GovernanceSeverity>>;
  readonly violations: readonly GovernanceViolation[];
  readonly criticalViolationCount: number;
  readonly consensusRequired: boolean;
  readonly consensusSatisfied: boolean;
  readonly promotable: boolean;
  readonly evaluationHash: string;
}

export interface GovernancePolicyOptions {
  readonly requireConsensusAtOrAbove?: Extract<RiskLevel, "HIGH" | "CRITICAL">;
}

export class GovernancePolicyError extends Error {
  readonly code = "GOVERNANCE_POLICY_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "GovernancePolicyError";
  }
}

const SEVERITY_RANK: Readonly<Record<GovernanceSeverity, number>> = Object.freeze({ NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 });
const RISK_RANK: Readonly<Record<RiskLevel, number>> = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });
const VALID_SEVERITIES = new Set<GovernanceSeverity>(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as Record<string, unknown>;
  return Object.keys(object).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = canonicalize(object[key]);
    return result;
  }, {});
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

export class GovernancePolicyEngine {
  private readonly consensusThreshold: RiskLevel;

  constructor(options: GovernancePolicyOptions = {}) {
    this.consensusThreshold = options.requireConsensusAtOrAbove ?? "HIGH";
  }

  evaluate(intent: IntentSpec, audit: EpistemicAuditRecord, risks: GovernanceRiskInput, consensus?: GovernanceConsensusInput): GovernanceEvaluation {
    if (audit.intentId !== intent.intentId) throw new GovernancePolicyError("Intent and audit identity mismatch");
    const normalized = this.normalizeRisks(risks);
    const violations: GovernanceViolation[] = [];

    for (const [vector, severity] of Object.entries(normalized) as [GovernanceRiskVector, GovernanceSeverity][]) {
      if (severity === "CRITICAL") {
        violations.push(Object.freeze({ vector, severity, reason: `${vector} is at critical severity` }));
      } else if (SEVERITY_RANK[severity] > RISK_RANK[intent.riskPolicy.maxRiskLevel]) {
        violations.push(Object.freeze({ vector, severity, reason: `${vector} exceeds the intent risk policy` }));
      }
    }

    const consensusRequired = RISK_RANK[intent.riskPolicy.maxRiskLevel] >= RISK_RANK[this.consensusThreshold];
    const consensusSatisfied = !consensusRequired || (
      consensus !== undefined &&
      consensus.disposition === "ACCEPT" &&
      Number.isFinite(consensus.weightedSupport) &&
      Number.isFinite(consensus.weightedOpposition) &&
      consensus.weightedSupport > consensus.weightedOpposition &&
      Number.isInteger(consensus.quorum) &&
      consensus.quorum > 0
    );

    if (consensusRequired && !consensusSatisfied) {
      violations.push(Object.freeze({ vector: "SECURITY_POSTURE", severity: "HIGH", reason: "Required governance consensus is absent or unresolved" }));
    }

    const criticalViolationCount = violations.filter((item) => item.severity === "CRITICAL").length;
    const promotable = audit.state === "VERIFIED" && violations.length === 0 && criticalViolationCount === 0 && consensusSatisfied;
    const content = Object.freeze({
      intentId: intent.intentId,
      auditState: audit.state,
      proofDigest: audit.proofDigest,
      riskLevel: intent.riskPolicy.maxRiskLevel,
      risks: normalized,
      violations: Object.freeze([...violations]),
      criticalViolationCount,
      consensusRequired,
      consensusSatisfied,
      promotable,
    });
    return Object.freeze({ ...content, evaluationHash: hash(content) });
  }

  private normalizeRisks(risks: GovernanceRiskInput): Readonly<Record<GovernanceRiskVector, GovernanceSeverity>> {
    const normalized = {
      SECURITY_POSTURE: risks.securityPosture,
      DESTRUCTIVE_SCOPE: risks.destructiveOperationalScope,
      DEPENDENCY_BOUNDARY: risks.dependencyBoundary,
      BREAKING_API_SURFACE: risks.breakingApiSurface,
    } as const;
    for (const [vector, severity] of Object.entries(normalized)) {
      if (!VALID_SEVERITIES.has(severity as GovernanceSeverity)) throw new GovernancePolicyError(`Invalid ${vector} severity`);
    }
    return Object.freeze(normalized);
  }
}
