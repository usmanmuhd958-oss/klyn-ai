import { TaskGraphPlan, TaskGraphPlanRequest } from "../types/task-graph.types.js";
export declare class TaskGraphPlanner {
    plan(request: TaskGraphPlanRequest): TaskGraphPlan;
    private buildEdges;
    private assertNodeExists;
    private assertNotSelfDependency;
    private buildDependencyMap;
    private freezeMap;
    private detectCycles;
    private topologicalSort;
}
//# sourceMappingURL=task-graph-planner.d.ts.map