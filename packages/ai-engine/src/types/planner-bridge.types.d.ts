import type { TaskGraphNode } from "./task-graph.types.js";
export type PlannerTaskStatus = "pending" | "queued" | "executing" | "completed" | "failed";
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
export type PlannerBridgeErrorCode = "PLANNER_BRIDGE_INVALID_PLAN" | "PLANNER_BRIDGE_MISSING_NODE" | "PLANNER_BRIDGE_MISSING_PREREQUISITE" | "PLANNER_BRIDGE_CYCLE" | "PLANNER_BRIDGE_INVALID_STATE" | "PLANNER_BRIDGE_STALE_STATE";
export declare class PlannerBridgeError extends Error {
    readonly code: PlannerBridgeErrorCode;
    constructor(code: PlannerBridgeErrorCode, message: string);
}
export declare class ImmutableTaskStateStore {
    #private;
    constructor(states: Iterable<readonly [string, PlannerRuntimeTaskState]>);
    get(taskId: string): PlannerRuntimeTaskState | undefined;
    has(taskId: string): boolean;
    get size(): number;
    entries(): readonly (readonly [string, PlannerRuntimeTaskState])[];
    values(): readonly PlannerRuntimeTaskState[];
    withState(taskId: string, state: PlannerRuntimeTaskState): ImmutableTaskStateStore;
}
//# sourceMappingURL=planner-bridge.types.d.ts.map