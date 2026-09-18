export class PlannerStateConflictError extends Error {
    code;
    taskId;
    expectedStateVersion;
    constructor(taskId, expectedStateVersion) {
        super(`Planner state conflict for task '${taskId}' at version ${expectedStateVersion}`);
        this.name = "PlannerStateConflictError";
        this.code = "PLANNER_STATE_VERSION_CONFLICT";
        this.taskId = taskId;
        this.expectedStateVersion = expectedStateVersion;
    }
}
//# sourceMappingURL=planner-persistence.types.js.map