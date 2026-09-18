import type { AuthorizationDecision, RiskLevel } from "@klyn/governance";

export type AgentTraceEventType =
  | "tool-call"
  | "memory-mutation"
  | "delegation"
  | "policy-snapshot"
  | "side-effect-observation"
  | "graph-node";

export type SideEffectKind =
  | "filesystem"
  | "network"
  | "database"
  | "secret"
  | "artifact"
  | "process"
  | "other";

export interface SideEffectObservation {
  readonly effectId: string;
  readonly kind: SideEffectKind;
  readonly locator: string;
  readonly operation: string;
  readonly digest?: string;
}

export interface MemoryStateMutation {
  readonly namespace: string;
  readonly key: string;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly declared: boolean;
}

export interface DelegationCascade {
  readonly delegationId: string;
  readonly parentAgentId: string;
  readonly childAgentId: string;
  readonly depth: number;
  readonly requestedRisk: RiskLevel;
  readonly delegatedToolNames: readonly string[];
}

export interface ToolCallBehavior {
  readonly toolName: string;
  readonly operation: string;
  readonly requestId: string;
  readonly authorization: AuthorizationDecision;
  readonly sideEffects: readonly SideEffectObservation[];
}

export interface AgentBehaviorEvent {
  readonly eventType: AgentTraceEventType;
  readonly missionId: string;
  readonly agentId: string;
  readonly parentAgentId?: string;
  readonly graphNodeId?: string;
  readonly timestampEpochMs: number;
  readonly policyVersion: string;
  readonly stateDigestBefore: string;
  readonly stateDigestAfter: string;
  readonly toolCall?: ToolCallBehavior;
  readonly memoryMutation?: MemoryStateMutation;
  readonly delegation?: DelegationCascade;
  readonly sideEffects?: readonly SideEffectObservation[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface AgentBehaviorTraceRecord {
  readonly sequence: number;
  readonly previousHash: string;
  readonly event: AgentBehaviorEvent;
  readonly hash: string;
}

export interface AgentBehaviorSnapshot {
  readonly missionId: string;
  readonly agentId: string;
  readonly length: number;
  readonly headHash: string;
  readonly records: readonly AgentBehaviorTraceRecord[];
}

export interface BehaviorPolicy {
  readonly missionId: string;
  readonly agentId: string;
  readonly expectedPolicyVersion: string;
  readonly maxDelegationDepth: number;
  readonly allowedToolOperations: Readonly<Record<string, readonly string[]>>;
  readonly allowedSideEffects: readonly SideEffectKind[];
  readonly requireToolAuthorization: boolean;
  readonly requireStateDigestChangeForMutation: boolean;
  readonly requireExplicitSideEffectDeclaration: boolean;
}

export type ConstraintViolationKind =
  | "hidden-state-shift"
  | "unauthorized-side-effect"
  | "policy-drift"
  | "invalid-delegation"
  | "missing-authorization"
  | "invalid-trace-sequence";

export interface ConstraintViolation {
  readonly kind: ConstraintViolationKind;
  readonly sequence: number;
  readonly message: string;
  readonly evidenceDigest: string;
  readonly timestampEpochMs: number;
}

export interface ConstraintEvaluation {
  readonly accepted: boolean;
  readonly violations: readonly ConstraintViolation[];
  readonly traceHeadHash: string;
  readonly evaluatedSequence: number;
}
