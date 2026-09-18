import type { PlannerConstraint, TaskGraphNode, TaskGraphPlanRequest } from "./task-graph.types.js";
export interface GoalDecompositionRequest {
    readonly goal: string;
    readonly agentType?: string;
    readonly constraints?: readonly PlannerConstraint[];
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface DecomposedTaskNode extends TaskGraphNode {
    readonly sequence: number;
}
export interface GoalDecompositionResult {
    readonly normalizedGoal: string;
    readonly nodes: readonly DecomposedTaskNode[];
    readonly planRequest: TaskGraphPlanRequest;
}
export type GoalDecomposerErrorCode = "GOAL_EMPTY" | "GOAL_INVALID_TYPE" | "GOAL_TOO_LONG" | "GOAL_NO_TASKS" | "GOAL_TASK_TOO_LONG";
export declare class GoalDecomposerError extends Error {
    readonly code: GoalDecomposerErrorCode;
    constructor(code: GoalDecomposerErrorCode, message: string);
}
//# sourceMappingURL=goal-decomposition.types.d.ts.map