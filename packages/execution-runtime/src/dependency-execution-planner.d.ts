export interface PlannedTask<T = unknown> {
    readonly id: string;
    readonly dependsOn?: readonly string[];
    readonly execute: (signal: AbortSignal) => Promise<T>;
}
export interface DependencyPlanResult<T = unknown> {
    readonly completed: readonly string[];
    readonly failed: readonly string[];
    readonly skipped: readonly string[];
    readonly outputs: Readonly<Record<string, T>>;
}
export declare class DependencyExecutionPlanner<T = unknown, TTask extends PlannedTask<T> = PlannedTask<T>> {
    execute(tasks: readonly TTask[], options?: {
        maxConcurrency?: number;
        signal?: AbortSignal;
    }): Promise<DependencyPlanResult<T>>;
}
//# sourceMappingURL=dependency-execution-planner.d.ts.map