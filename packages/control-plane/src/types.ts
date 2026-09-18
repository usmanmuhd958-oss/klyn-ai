import type { AuthorizationDecision, GovernanceEngine, ToolExecutionRequest } from "@klyn/governance";
import type {
  MissionEvidence,
  MissionGraph,
  MissionSnapshot,
  TransitionResult,
} from "@klyn/mission-engine";
import type {
  RuntimeExecutionResult,
  TaskSpec,
} from "@klyn/runtime";
import type {
  BudgetAdmission,
  BudgetLedger,
  BudgetUsageSnapshot,
  ContainmentDecision,
  UsageMetrics,
} from "@klyn/autonomy";

export interface ControlPlaneIntent {
  readonly missionId: string;
  readonly objectiveId: string;
  readonly statement: string;
  readonly requestedTool: string;
  readonly requestedOperation: string;
}

export interface ControlPlaneExecutionRequest {
  readonly intent: ControlPlaneIntent;
  readonly authorizationRequest: ToolExecutionRequest;
  readonly authorizationScopes: readonly unknown[];
  readonly task: TaskSpec;
  readonly estimatedUsage: UsageMetrics;
  readonly finalUsageDelta?: UsageMetrics;
  readonly usageStream?: AsyncIterable<UsageMetrics>;
}

export interface ExecutionReport {
  readonly authorization: AuthorizationDecision;
  readonly budgetAdmission: BudgetAdmission;
  readonly runtime: RuntimeExecutionResult;
  readonly containment: readonly ContainmentDecision[];
  readonly budget: BudgetUsageSnapshot;
}

export type MissionEvidenceDraft = Omit<MissionEvidence, "payloadDigest" | "signatureBase64">;

export interface MissionEvidenceAttestor {
  readonly verifierId: string;
  attest(draft: MissionEvidenceDraft): MissionEvidence;
}

export interface MissionRunResult {
  readonly mission: MissionSnapshot;
  readonly intent: ControlPlaneIntent;
  readonly execution: ExecutionReport;
  readonly transition?: TransitionResult;
}

export interface EvidenceTransitionResult {
  readonly evidence: MissionEvidence;
  readonly transition: TransitionResult;
}

export interface MissionControllerOptions {
  readonly governance: GovernanceEngine;
  readonly missionGraph: MissionGraph;
  readonly missionStateMachine: {
    snapshot(): MissionSnapshot;
    transition(input: unknown): TransitionResult;
  };
  readonly execution: {
    execute(input: ControlPlaneExecutionRequest): Promise<ExecutionReport>;
  };
  readonly evidenceAttestor: MissionEvidenceAttestor;
  readonly nowEpochMs?: () => number;
}

export interface ExecutionControllerOptions {
  readonly governance: GovernanceEngine;
  readonly runtime: {
    execute(input: unknown, signal?: AbortSignal): Promise<RuntimeExecutionResult>;
  };
  readonly budget: BudgetLedger;
  readonly containment: {
    monitor(stream: AsyncIterable<UsageMetrics>, signal: AbortSignal): Promise<void>;
    intercept(delta: UsageMetrics, nowEpochMs?: number): Promise<ContainmentDecision>;
    isTerminated(): boolean;
    recentDecisions(): readonly ContainmentDecision[];
    assertOperational(): void;
  };
}

export interface ControlPlaneContainmentOptions {
  readonly missionId: string;
  readonly agentId: string;
  readonly principalId: string;
  readonly governance: GovernanceEngine;
  readonly budget: BudgetLedger;
  readonly onEscalate?: (decision: ContainmentDecision) => boolean | Promise<boolean>;
  readonly onTerminate?: (decision: ContainmentDecision) => void | Promise<void>;
}
