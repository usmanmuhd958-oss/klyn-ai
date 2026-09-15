import type { TaskGraphNode } from "./task-graph.types.js";

export type PlannerTaskStatus =
  | "pending"
  | "queued"
  | "executing"
  | "completed"
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
  readonly stateVersion: number;
}

export interface PlannerBridgeResult {
  readonly executionId: string;
  readonly namespace: string;
  readonly batches: readonly ExecutableTaskBatch[];
  readonly taskStates: ImmutableTaskStateStore;
  readonly executionOrder: readonly string[];
}

export interface PlannerBridgeStateUpdate {
  readonly taskId: string;
  readonly status: PlannerTaskStatus;
  readonly expectedStateVersion: number;
}

export type PlannerBridgeErrorCode =
  | "PLANNER_BRIDGE_INVALID_PLAN"
  | "PLANNER_BRIDGE_MISSING_NODE"
  | "PLANNER_BRIDGE_MISSING_PREREQUISITE"
  | "PLANNER_BRIDGE_CYCLE"
  | "PLANNER_BRIDGE_INVALID_STATE"
  | "PLANNER_BRIDGE_STALE_STATE";

export class PlannerBridgeError extends Error {
  public readonly code: PlannerBridgeErrorCode;

  public constructor(code: PlannerBridgeErrorCode, message: string) {
    super(message);
    this.name = "PlannerBridgeError";
    this.code = code;
  }
}

export class ImmutableTaskStateStore {
  readonly #states: Readonly<Record<string, PlannerRuntimeTaskState>>;

  public constructor(states: Iterable<readonly [string, PlannerRuntimeTaskState]>) {
    const record: Record<string, PlannerRuntimeTaskState> = Object.create(null) as Record<string, PlannerRuntimeTaskState>;
    for (const [taskId, state] of states) {
      record[taskId] = freezeTaskState(state);
    }
    this.#states = Object.freeze(record);
  }

  public get(taskId: string): PlannerRuntimeTaskState | undefined {
    return this.#states[taskId];
  }

  public has(taskId: string): boolean {
    return this.#states[taskId] !== undefined;
  }

  public get size(): number {
    return Object.keys(this.#states).length;
  }

  public entries(): readonly (readonly [string, PlannerRuntimeTaskState])[] {
    return Object.freeze(
      Object.keys(this.#states)
        .sort()
        .map((taskId) => Object.freeze([taskId, this.#states[taskId]]) as readonly [string, PlannerRuntimeTaskState]),
    );
  }

  public values(): readonly PlannerRuntimeTaskState[] {
    return Object.freeze(this.entries().map((entry) => entry[1]));
  }

  public withState(taskId: string, state: PlannerRuntimeTaskState): ImmutableTaskStateStore {
    const next = this.entries().map(([id, existing]) => [id, existing] as const);
    const existingIndex = next.findIndex(([id]) => id === taskId);
    if (existingIndex >= 0) {
      next[existingIndex] = [taskId, freezeTaskState(state)];
    } else {
      next.push([taskId, freezeTaskState(state)]);
    }
    return new ImmutableTaskStateStore(next);
  }
}

function freezeTaskState(state: PlannerRuntimeTaskState): PlannerRuntimeTaskState {
  return Object.freeze({
    ...state,
    prerequisites: Object.freeze([...state.prerequisites]),
    completedPrerequisites: Object.freeze([...state.completedPrerequisites]),
  });
}
