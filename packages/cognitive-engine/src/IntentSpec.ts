import { createHash } from "node:crypto";

export type IntentState = "DRAFT" | "VALIDATING" | "VALIDATED" | "FROZEN" | "EXECUTABLE" | "REJECTED";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ConstraintKind = "INVARIANT" | "PROHIBITION" | "REQUIREMENT";
export type DependencyKind = "PACKAGE" | "SERVICE" | "RESOURCE" | "INTENT";
export type EvidenceKind = "TEST_RESULT" | "BUILD_RESULT" | "ARTIFACT_HASH" | "OBSERVATION" | "PROOF" | "REVIEW";
export type VerificationMethod = "TEST" | "OBSERVATION" | "PROOF" | "MANUAL_REVIEW";

export const INTENT_SCHEMA_VERSION = "1.0.0" as const;

export interface Objective {
  readonly statement: string;
  readonly outcome: string;
  readonly scope: readonly string[];
}

export interface Constraint {
  readonly id: string;
  readonly kind: ConstraintKind;
  readonly statement: string;
}

export interface Assumption {
  readonly id: string;
  readonly statement: string;
}

export interface Dependency {
  readonly id: string;
  readonly kind: DependencyKind;
  readonly name: string;
  readonly version?: string;
  readonly required: boolean;
  readonly dependsOn: readonly string[];
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly description: string;
  readonly verification: VerificationMethod;
  readonly required: boolean;
}

export interface RiskPolicy {
  readonly maxRiskLevel: RiskLevel;
  readonly allowedActions: readonly string[];
  readonly requireHumanApproval: boolean;
  readonly autoPromotion: boolean;
}

export interface RequiredEvidence {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly description: string;
  readonly required: boolean;
}

export interface ResourceBudget {
  readonly maxCpuMillis: number;
  readonly maxMemoryBytes: number;
  readonly maxWallClockMillis: number;
  readonly maxConcurrentTasks: number;
  readonly maxNetworkRequests: number;
  readonly maxArtifactBytes: number;
}

export interface IntentContent {
  readonly specVersion: string;
  readonly objective: Objective;
  readonly constraints: readonly Constraint[];
  readonly assumptions: readonly Assumption[];
  readonly dependencies: readonly Dependency[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly riskPolicy: RiskPolicy;
  readonly requiredEvidence: readonly RequiredEvidence[];
  readonly resourceBudget: ResourceBudget;
}

export interface IntentSpec extends IntentContent {
  readonly schemaVersion: typeof INTENT_SCHEMA_VERSION;
  readonly intentId: string;
  readonly contentHash: string;
  readonly canonicalContent: string;
  readonly state: IntentState;
}

export interface IntentRejection {
  readonly schemaVersion: typeof INTENT_SCHEMA_VERSION;
  readonly state: "REJECTED";
  readonly issues: readonly IntentValidationIssue[];
  readonly sourceHash?: string;
}

export type IntentCompilationResult =
  | { readonly accepted: true; readonly spec: IntentSpec }
  | { readonly accepted: false; readonly rejection: IntentRejection };

export interface IntentValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface FrozenIntentContent extends IntentContent {
  readonly contentHash: string;
  readonly intentId: string;
}

export function deriveDeterministicIntentId(contentHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("contentHash must be a 64-character lowercase SHA-256 hex digest");
  const bytes = Buffer.from(contentHash.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function verifyIntentContentHash(spec: Pick<IntentSpec, "canonicalContent" | "contentHash">): boolean {
  const actual = createHash("sha256").update(spec.canonicalContent, "utf8").digest("hex");
  return actual === spec.contentHash;
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;
