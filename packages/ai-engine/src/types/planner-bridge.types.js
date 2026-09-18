export class PlannerBridgeError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "PlannerBridgeError";
        this.code = code;
    }
}
export class ImmutableTaskStateStore {
    #states;
    constructor(states) {
        const record = Object.create(null);
        for (const [taskId, state] of states) {
            record[taskId] = freezeTaskState(state);
        }
        this.#states = Object.freeze(record);
    }
    get(taskId) {
        return this.#states[taskId];
    }
    has(taskId) {
        return this.#states[taskId] !== undefined;
    }
    get size() {
        return Object.keys(this.#states).length;
    }
    entries() {
        return Object.freeze(Object.keys(this.#states)
            .sort()
            .map((taskId) => Object.freeze([taskId, this.#states[taskId]])));
    }
    values() {
        return Object.freeze(this.entries().map((entry) => entry[1]));
    }
    withState(taskId, state) {
        const next = this.entries().map(([id, existing]) => [id, existing]);
        const existingIndex = next.findIndex(([id]) => id === taskId);
        if (existingIndex >= 0) {
            next[existingIndex] = [taskId, freezeTaskState(state)];
        }
        else {
            next.push([taskId, freezeTaskState(state)]);
        }
        return new ImmutableTaskStateStore(next);
    }
}
function freezeTaskState(state) {
    return Object.freeze({
        ...state,
        prerequisites: Object.freeze([...state.prerequisites]),
        completedPrerequisites: Object.freeze([...state.completedPrerequisites]),
    });
}
//# sourceMappingURL=planner-bridge.types.js.map