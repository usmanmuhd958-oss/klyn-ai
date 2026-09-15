import type { TaskGraphNode } from "./task-graph.types.js";

export type PlannerTaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "blocked"
  | "failed";

export interface PlannerBridgeOptions {
  readonly executionId?: string;
  readonly namespace?: string;
}

export interface ExecutableTask {
  readonly node: TaskGraphNode;
  readonly prerequisites: readonly string[];
  readonly dependents: readonly string[];
}

export interface ExecutableTaskBatch {
  readonly phase: number;
  readonly tasks: readonly ExecutableTask[];
}

export interface PlannerRuntimeTaskState {
  readonly taskId: string;
  readonly status: PlannerTaskStatus;
  readonly phase: number;
  readonly prerequisites: readonly string[];
  readonly completedPrerequisites: readonly string[];
  readonly executionId: string;
  readonly namespace: string;
}

export interface PlannerBridgeResult {
  readonly executionId: string;
  readonly namespace: string;
  readonly batches: readonly ExecutableTaskBatch[];
  readonly taskStates: ReadonlyMap<string, PlannerRuntimeTaskState>;
  readonly executionOrder: readonly string[];
}

export type PlannerBridgeErrorCode =
  | "PLANNER_BRIDGE_INVALID_PLAN"
  | "PLANNER_BRIDGE_MISSING_NODE"
  | "PLANNER_BRIDGE_MISSING_PREREQUISITE"
  | "PLANNER_BRIDGE_CYCLE"
  | "PLANNER_BRIDGE_INVALID_STATE";

export class PlannerBridgeError extends Error {
  public readonly code: PlannerBridgeErrorCode;

  public constructor(code: PlannerBridgeErrorCode, message: string) {
    super(message);
    this.name = "PlannerBridgeError";
    this.code = code;
  }
}

export interface PlannerBridgeStateUpdate {
  readonly taskId: string;
  readonly status: PlannerTaskStatus;
}
