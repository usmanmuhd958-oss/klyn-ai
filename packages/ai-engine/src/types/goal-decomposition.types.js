export class GoalDecomposerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "GoalDecomposerError";
        this.code = code;
    }
}
//# sourceMappingURL=goal-decomposition.types.js.map