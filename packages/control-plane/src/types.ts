export type Brand<T, B extends string> = T & { readonly __brand: B };

export type MissionId = Brand<string, "MissionId">;
export type ExecutionId = Brand<string, "ExecutionId">;
export type AgentId = Brand<string, "AgentId">;
export type SandboxId = Brand<string, "SandboxId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type EventId = Brand<string, "EventId">;
export type CredentialId = Brand<string, "CredentialId">;
export type PolicyId = Brand<string, "PolicyId">;
export type TransitionId = Brand<string, "TransitionId">;
export type CheckpointId = Brand<string, "CheckpointId">;
export type TenantId = Brand<string, "TenantId">;
export type EnvelopeId = Brand<string, "EnvelopeId">;
export type WorkerId = Brand<string, "WorkerId">;

export type Hash256 = Brand<string, "SHA256Hex">;

export function brand<T, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}

export function isHash256(value: string): value is Hash256 {
  return /^[a-f0-9]{64}$/.test(value);
}

export const MISSION_STATES = [
  "INTENT_CAPTURED",
  "ENVELOPE_DEFINED",
  "PLAN_GENERATED",
  "ACTION_EXECUTED",
  "ARTIFACT_PRODUCED",
  "AUTOMATED_VERIFICATION",
  "HUMAN_APPROVAL",
  "PRODUCTION_ROLLOUT_AUDITED",
] as const;

export type MissionState = (typeof MISSION_STATES)[number];

export const EVENT_TYPES = [
  "MissionCreated",
  "StateTransitionRequested",
  "StateTransitionCommitted",
  "AgentStarted",
  "AgentStopped",
  "AgentCheckpointed",
  "ToolCallRequested",
  "ToolCallAuthorized",
  "ToolCallStarted",
  "ToolCallCompleted",
  "ToolCallRejected",
  "ResourceAllocated",
  "ResourceConsumed",
  "ResourceExhausted",
  "CredentialIssued",
  "CredentialRevoked",
  "SandboxCreated",
  "SandboxStarted",
  "SandboxExecutionStarted",
  "SandboxDestroyed",
  "VerificationStarted",
  "VerificationPassed",
  "VerificationFailed",
  "AnomalyDetected",
  "HumanApprovalRequested",
  "HumanApprovalGranted",
  "HumanApprovalRejected",
  "CircuitBreakerTriggered",
  "RolloutStarted",
  "RolloutCompleted",
  "RolloutAborted",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type BreakerLevel =
  | "NONE"
  | "SOFT_HALT"
  | "EXECUTION_HALT"
  | "MISSION_HALT"
  | "TENANT_HALT";

export const BREAKER_ORDER: Record<BreakerLevel, number> = {
  NONE: 0,
  SOFT_HALT: 1,
  EXECUTION_HALT: 2,
  MISSION_HALT: 3,
  TENANT_HALT: 4,
};

export type Capability =
  | "RepoRead"
  | "RepoWrite"
  | "ProcessExecute"
  | "NetworkConnect"
  | "ArtifactRead"
  | "ArtifactWrite"
  | "SecretReadScoped"
  | "DeployStaging"
  | "DeployProduction"
  | "DatabaseRead"
  | "DatabaseWrite";

export type PrivacyLevel =
  | "LOCAL_ON_PREM_ONLY"
  | "SOVEREIGN_CLOUD_ALLOWED"
  | "PUBLIC_CLOUD_ALLOWED";

export type WorkerHealth = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export interface ActorIdentity {
  readonly actorId: AgentId | TenantId;
  readonly principalType: "AGENT" | "SERVICE" | "HUMAN" | "SYSTEM";
}

export interface AuthorizationContext {
  readonly policyId: PolicyId;
  readonly decisionId: string;
  readonly expiresAt: string;
  readonly capabilities: readonly Capability[];
}

export interface LedgerEventInput {
  readonly missionId: MissionId;
  readonly executionId?: ExecutionId;
  readonly eventType: EventType;
  readonly occurredAt: string;
  readonly actor: ActorIdentity;
  readonly authorization?: AuthorizationContext;
  readonly schemaVersion: number;
  readonly payload: unknown;
}

export interface LedgerEvent extends LedgerEventInput {
  readonly eventId: EventId;
  readonly sequence: bigint;
  readonly previousHash: Hash256;
  readonly payloadHash: Hash256;
  readonly eventHash: Hash256;
}

export interface MissionRecord {
  readonly missionId: MissionId;
  readonly tenantId: TenantId;
  readonly policyId: PolicyId;
  readonly state: MissionState;
  readonly version: bigint;
  readonly breakerLevel: BreakerLevel;
  readonly breakerReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly ledgerSequence: bigint;
  readonly ledgerHeadHash: Hash256;
}

export interface CreateMissionInput {
  readonly missionId: MissionId;
  readonly tenantId: TenantId;
  readonly policyId: PolicyId;
  readonly occurredAt: string;
  readonly actor: ActorIdentity;
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly idempotencyKey: string;
}

export interface TransitionContext {
  readonly envelopeValid: boolean;
  readonly planAuthorized: boolean;
  readonly executionSucceeded: boolean;
  readonly artifactProvenanceValid: boolean;
  readonly verificationStatus: "NOT_RUN" | "PASSED" | "FAILED" | "INCONCLUSIVE";
  readonly humanApprovalValid: boolean;
  readonly rolloutSucceeded: boolean;
  readonly breakerLevel: BreakerLevel;
}

export interface ResourceEnvelope {
  readonly envelopeId: EnvelopeId;
  readonly missionId: MissionId;
  readonly executionId: ExecutionId;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly tokenBudget: Readonly<TokenBudget>;
  readonly computeBudget: Readonly<ComputeBudget>;
  readonly latencyBudget: Readonly<LatencyBudget>;
  readonly allowedCapabilities: readonly Capability[];
  readonly networkPolicy: NetworkPolicy;
  readonly signaturePolicyId: PolicyId;
  readonly signature: string;
}

export interface TokenBudget {
  readonly inputMax: bigint;
  readonly outputMax: bigint;
  readonly totalMax: bigint;
}

export interface ComputeBudget {
  readonly cpuMillicores: number;
  readonly memoryBytes: bigint;
  readonly gpuMillicores: number;
  readonly diskWriteBytesMax: bigint;
  readonly networkEgressBytesMax: bigint;
}

export interface LatencyBudget {
  readonly missionTimeoutMs: number;
  readonly executionTimeoutMs: number;
  readonly toolTimeoutMs: number;
}

export interface NetworkPolicy {
  readonly allowEgress: boolean;
  readonly allowedHosts: readonly string[];
}

export interface ResourceUsage {
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cpuMillicoresMs: number;
  readonly memoryBytesPeak: bigint;
  readonly gpuMillicoresMs: number;
  readonly diskWriteBytes: bigint;
  readonly networkEgressBytes: bigint;
  readonly wallClockMs: number;
}

export interface ResourceReservation {
  readonly reservationId: string;
  readonly envelopeId: EnvelopeId;
  readonly executionId: ExecutionId;
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cpuMillicoresMs: number;
  readonly memoryBytes: bigint;
  readonly gpuMillicoresMs: number;
  readonly diskWriteBytes: bigint;
  readonly networkEgressBytes: bigint;
  readonly wallClockMs: number;
  readonly committed: boolean;
}

export interface CredentialGrant {
  readonly credentialId: CredentialId;
  readonly executionId: ExecutionId;
  readonly provider: string;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly audience: string;
  readonly nonce: string;
  readonly token: string;
}

export interface CredentialRequest {
  readonly executionId: ExecutionId;
  readonly provider: string;
  readonly scopes: readonly string[];
  readonly audience: string;
  readonly ttlSeconds: number;
}

export interface MintedCredential {
  readonly token: string;
}

export interface CredentialMinter {
  mint(request: CredentialRequest): Promise<MintedCredential>;
}

export interface ExecutionRequirements {
  readonly requiredCapabilities: readonly Capability[];
  readonly minMemoryBytes: bigint;
  readonly minCpuCores: number;
  readonly gpuRequired: boolean;
  readonly locality: PrivacyLevel;
  readonly privacy: PrivacyLevel;
  readonly networkRequired: boolean;
  readonly modelCapabilities: readonly string[];
  readonly maxQueueDepth?: number;
}

export interface WorkerNode {
  readonly nodeId: WorkerId;
  readonly executionClass: "PROCESS" | "CONTAINER" | "MICROVM" | "REMOTE_MODEL";
  readonly availableMemoryBytes: bigint;
  readonly availableCpuCores: number;
  readonly hasGpu: boolean;
  readonly privacyDomain: PrivacyLevel;
  readonly capabilities: readonly Capability[];
  readonly modelCapabilities: readonly string[];
  readonly queueDepth: number;
  readonly latencyP50Ms: number;
  readonly estimatedCostMilliunits: number;
  readonly health: WorkerHealth;
  readonly networkAvailable: boolean;
}

export interface WorkerScore {
  readonly workerId: WorkerId;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface SchedulerWeights {
  readonly latency: number;
  readonly cost: number;
  readonly locality: number;
  readonly queue: number;
}

export interface ContextNode {
  readonly nodeId: string;
  readonly missionId: MissionId;
  readonly layer: "L0" | "L1" | "L2";
  readonly kind: "FACT" | "CONSTRAINT" | "DECISION" | "TOOL_RESULT" | "ARTIFACT" | "VERIFICATION" | "REFERENCE";
  readonly summary: string;
  readonly contentDigest: Hash256;
  readonly tokenCost: number;
  readonly importance: number;
  readonly critical: boolean;
  readonly sourceEventIds: readonly EventId[];
  readonly parents: readonly string[];
}

export interface ContextProjection {
  readonly missionId: MissionId;
  readonly nodes: readonly ContextNode[];
  readonly omittedNodeIds: readonly string[];
  readonly retainedTokenEstimate: number;
  readonly originalTokenEstimate: number;
  readonly reductionRatio: number;
  readonly losslessForCriticalState: boolean;
}

export interface AnomalyVector {
  readonly identity: number;
  readonly capability: number;
  readonly resource: number;
  readonly temporal: number;
  readonly state: number;
  readonly sequence: number;
  readonly artifact: number;
  readonly infrastructure: number;
}

export interface AnomalyEvidence {
  readonly hardViolations: readonly string[];
  readonly behavioralDistance: number;
  readonly systemDriftDistance: number;
  readonly breakerLevel: BreakerLevel;
}
