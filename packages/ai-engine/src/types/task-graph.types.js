export class TaskGraphPlannerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "TaskGraphPlannerError";
        this.code = code;
    }
}
//# sourceMappingURL=task-graph.types.js.map