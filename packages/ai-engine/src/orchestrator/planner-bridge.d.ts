import type { TaskGraphPlan } from "../types/task-graph.types.js";
import { type PlannerBridgeOptions, type PlannerBridgeResult, type PlannerBridgeStateUpdate } from "../types/planner-bridge.types.js";
export declare class PlannerBridge {
    private readonly options;
    constructor(options?: PlannerBridgeOptions);
    bridge(plan: TaskGraphPlan): PlannerBridgeResult;
    synchronizeState(result: PlannerBridgeResult, update: PlannerBridgeStateUpdate): PlannerBridgeResult;
    private validatePlan;
    private buildBatches;
    private validateTransition;
}
//# sourceMappingURL=planner-bridge.d.ts.map