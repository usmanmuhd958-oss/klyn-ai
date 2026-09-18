import type { GoalDecompositionRequest, GoalDecompositionResult } from "../types/goal-decomposition.types.js";
export declare class GoalDecompositionEngine {
    decompose(request: GoalDecompositionRequest): GoalDecompositionResult;
    private normalizeGoal;
    private normalizeAgentType;
    private normalizeConstraints;
    private extractTaskFragments;
    private cleanFragment;
    private toTitle;
}
//# sourceMappingURL=goal-decomposition-engine.d.ts.map