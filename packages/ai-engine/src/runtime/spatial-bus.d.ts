import { type SpatialCanvasNodeState, type SpatialExecutionBusOptions, type SpatialExecutionInput, type SpatialRuntimeStream, type SpatialTaskExecutor } from "../types/spatial-bus.types.js";
export declare class SpatialBus {
    #private;
    constructor(options?: SpatialExecutionBusOptions);
    register(plan: SpatialExecutionInput): SpatialRuntimeStream;
    run(plan: SpatialExecutionInput, executor: SpatialTaskExecutor): Promise<SpatialRuntimeStream>;
    transitionNode(executionId: string, taskId: string, status: Exclude<SpatialCanvasNodeState["status"], "pending">, error?: string): SpatialCanvasNodeState;
    getNodeState(executionId: string, taskId: string): SpatialCanvasNodeState | undefined;
    getExecutionStates(executionId: string): readonly SpatialCanvasNodeState[];
    close(executionId: string): void;
    clear(): void;
    get activeExecutionCount(): number;
    private validatePlan;
    private assertPrerequisitesComplete;
    private transition;
    private assertTransition;
    private taskForState;
    private eventTypeFor;
    private emit;
    private snapshot;
    private getExecution;
    private executionKey;
    private nextSequence;
}
//# sourceMappingURL=spatial-bus.d.ts.map