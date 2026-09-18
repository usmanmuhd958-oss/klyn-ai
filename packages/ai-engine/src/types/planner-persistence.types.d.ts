import type { PlannerRuntimeTaskState, PlannerTaskStatus } from "./planner-bridge.types.js";
export interface PlannerStatePersistenceConfig {
    readonly supabaseUrl: string;
    readonly apiKey: string;
    readonly accessToken: string;
    readonly ownerUserId: string;
}
export interface PlannerStateCompareAndSwapInput {
    readonly executionId: string;
    readonly taskId: string;
    readonly expectedStateVersion: number;
    readonly status: PlannerTaskStatus;
    readonly phase: number;
    readonly prerequisites: readonly string[];
    readonly completedPrerequisites: readonly string[];
    readonly executionOrder: number;
    readonly node: Readonly<Record<string, unknown>>;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface PlannerStatePersistenceRow {
    readonly execution_id: string;
    readonly task_id: string;
    readonly namespace: string;
    readonly phase: number;
    readonly status: PlannerTaskStatus;
    readonly prerequisites: readonly string[];
    readonly completed_prerequisites: readonly string[];
    readonly execution_order: number;
    readonly state_version: number;
    readonly node: Readonly<Record<string, unknown>>;
    readonly metadata: Readonly<Record<string, unknown>>;
}
export type PlannerStateConflictCode = "PLANNER_STATE_VERSION_CONFLICT";
export declare class PlannerStateConflictError extends Error {
    readonly code: PlannerStateConflictCode;
    readonly taskId: string;
    readonly expectedStateVersion: number;
    constructor(taskId: string, expectedStateVersion: number);
}
export interface PlannerStatePersistence {
    compareAndSwap(input: PlannerStateCompareAndSwapInput): Promise<PlannerRuntimeTaskState>;
}
//# sourceMappingURL=planner-persistence.types.d.ts.map