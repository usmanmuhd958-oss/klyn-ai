export interface PlannerConstraint {
  readonly type: string;
  readonly value?: unknown;
  readonly description?: string;
}

export interface TaskGraphNode {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly agentType: string;
  readonly dependencies: readonly string[];
  readonly constraints: readonly PlannerConstraint[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TaskEdge {
  readonly from: string;
  readonly to: string;
}

export interface ExecutionDependencyMap {
  readonly prerequisites: ReadonlyMap<string, readonly string[]>;
  readonly dependents: ReadonlyMap<string, readonly string[]>;
}

export interface TaskGraphPlanRequest {
  readonly goal: string;
  readonly nodes: readonly TaskGraphNode[];
  readonly edges?: readonly TaskEdge[];
  readonly constraints?: readonly PlannerConstraint[];
}

export interface TaskGraphPlan {
  readonly nodes: readonly TaskGraphNode[];
  readonly edges: readonly TaskEdge[];
  readonly dependencyMap: ExecutionDependencyMap;
  readonly executionOrder: readonly string[];
}

export type TaskGraphPlannerErrorCode =
  | "TASK_GRAPH_CYCLE"
  | "TASK_GRAPH_MISSING_NODE"
  | "TASK_GRAPH_DUPLICATE_NODE"
  | "TASK_GRAPH_EMPTY"
  | "TASK_GRAPH_SELF_CYCLE";

export class TaskGraphPlannerError extends Error {
  public readonly code: TaskGraphPlannerErrorCode;

  public constructor(code: TaskGraphPlannerErrorCode, message: string) {
    super(message);
    this.name = "TaskGraphPlannerError";
    this.code = code;
  }
}
