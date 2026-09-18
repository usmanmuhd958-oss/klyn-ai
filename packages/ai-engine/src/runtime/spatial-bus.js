import { SpatialBusError, } from "../types/spatial-bus.types.js";
const DEFAULT_NAMESPACE = "default";
const DEFAULT_MAX_BUFFERED_EVENTS = 1000;
class StreamController {
    executionId;
    namespace;
    #maxBufferedEvents;
    #bufferedEvents = [];
    #listeners = new Set();
    #closed = false;
    constructor(executionId, namespace, maxBufferedEvents) {
        this.executionId = executionId;
        this.namespace = namespace;
        this.#maxBufferedEvents = maxBufferedEvents;
    }
    get events() {
        return Object.freeze([...this.#bufferedEvents]);
    }
    subscribe(listener) {
        if (this.#closed) {
            return () => undefined;
        }
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
    clear() {
        this.#bufferedEvents = [];
    }
    close() {
        this.#closed = true;
        this.#listeners.clear();
        this.clear();
    }
    emit(event) {
        if (this.#closed) {
            return;
        }
        this.#bufferedEvents = [...this.#bufferedEvents, Object.freeze(event)].slice(-this.#maxBufferedEvents);
        const listeners = [...this.#listeners];
        for (const listener of listeners) {
            try {
                listener(event);
            }
            catch {
                // Observer failures cannot change committed execution state.
            }
        }
    }
}
export class SpatialBus {
    #namespace;
    #maxBufferedEvents;
    #executions = new Map();
    #sequence = 0;
    constructor(options = {}) {
        this.#namespace = options.namespace?.trim() || DEFAULT_NAMESPACE;
        this.#maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
        if (!Number.isInteger(this.#maxBufferedEvents) || this.#maxBufferedEvents < 1) {
            throw new SpatialBusError("SPATIAL_BUS_BUFFER_LIMIT", "maxBufferedEvents must be a positive integer");
        }
    }
    register(plan) {
        this.validatePlan(plan);
        const key = this.executionKey(plan.executionId);
        if (this.#executions.has(key)) {
            throw new SpatialBusError("SPATIAL_BUS_DUPLICATE_EXECUTION", `Execution '${plan.executionId}' already exists in namespace '${this.#namespace}'`);
        }
        let nodeMap = new Map();
        for (const batch of plan.batches) {
            for (const task of batch.tasks) {
                if (nodeMap.has(task.node.id)) {
                    throw new SpatialBusError("SPATIAL_BUS_INVALID_INPUT", `Task '${task.node.id}' appears more than once in execution batches`);
                }
                nodeMap = new Map(nodeMap).set(task.node.id, Object.freeze({
                    taskId: task.node.id,
                    status: "pending",
                    phase: batch.phase,
                    prerequisites: Object.freeze([...task.prerequisites]),
                    completedPrerequisites: Object.freeze([]),
                    executionId: plan.executionId,
                    namespace: this.#namespace,
                    sequence: 0,
                }));
            }
        }
        const stream = new StreamController(plan.executionId, this.#namespace, this.#maxBufferedEvents);
        const record = {
            executionId: plan.executionId,
            namespace: this.#namespace,
            nodes: nodeMap,
            stream,
        };
        this.#executions = new Map(this.#executions).set(key, record);
        this.emit(record, "execution:started");
        return stream;
    }
    async run(plan, executor) {
        const stream = this.register(plan);
        const record = this.getExecution(plan.executionId);
        for (const batch of plan.batches) {
            const tasks = [...batch.tasks].sort((left, right) => left.node.id.localeCompare(right.node.id));
            for (const task of tasks) {
                this.transition(record, task.node.id, "queued");
            }
            for (const task of tasks) {
                this.assertPrerequisitesComplete(record, task);
                this.transition(record, task.node.id, "executing");
                try {
                    await executor(task);
                    this.transition(record, task.node.id, "completed");
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : "Task execution failed";
                    this.transition(record, task.node.id, "failed", message);
                    this.emit(record, "execution:failed", undefined, message);
                    return stream;
                }
            }
        }
        this.emit(record, "execution:completed");
        return stream;
    }
    transitionNode(executionId, taskId, status, error) {
        const record = this.getExecution(executionId);
        const state = record.nodes.get(taskId);
        if (!state) {
            throw new SpatialBusError("SPATIAL_BUS_MISSING_NODE", `Task '${taskId}' does not exist in execution '${executionId}'`);
        }
        this.assertTransition(state.status, status);
        if (status === "executing") {
            this.assertPrerequisitesComplete(record, this.taskForState(state));
        }
        this.transition(record, taskId, status, error);
        return this.snapshot(record.nodes.get(taskId));
    }
    getNodeState(executionId, taskId) {
        const record = this.#executions.get(this.executionKey(executionId));
        const state = record?.nodes.get(taskId);
        return state ? this.snapshot(state) : undefined;
    }
    getExecutionStates(executionId) {
        const record = this.getExecution(executionId);
        return Object.freeze([...record.nodes.values()]
            .sort((left, right) => left.sequence - right.sequence || left.taskId.localeCompare(right.taskId))
            .map((state) => this.snapshot(state)));
    }
    close(executionId) {
        const key = this.executionKey(executionId);
        const record = this.#executions.get(key);
        if (!record) {
            return;
        }
        this.emit(record, "execution:closed");
        record.stream.close();
        this.#executions = new Map(this.#executions);
        this.#executions.delete(key);
    }
    clear() {
        for (const record of this.#executions.values()) {
            this.emit(record, "execution:closed");
            record.stream.close();
        }
        this.#executions = new Map();
    }
    get activeExecutionCount() {
        return this.#executions.size;
    }
    validatePlan(plan) {
        if (!plan || typeof plan.executionId !== "string" || !plan.executionId.trim()) {
            throw new SpatialBusError("SPATIAL_BUS_INVALID_INPUT", "A non-empty executionId is required");
        }
        if (!Array.isArray(plan.batches) || plan.batches.length === 0) {
            throw new SpatialBusError("SPATIAL_BUS_INVALID_INPUT", "At least one execution batch is required");
        }
    }
    assertPrerequisitesComplete(record, task) {
        for (const prerequisite of task.prerequisites) {
            const state = record.nodes.get(prerequisite);
            if (!state) {
                throw new SpatialBusError("SPATIAL_BUS_MISSING_NODE", `Prerequisite '${prerequisite}' for task '${task.node.id}' is missing`);
            }
            if (state.status !== "completed") {
                throw new SpatialBusError("SPATIAL_BUS_PREREQUISITE_INCOMPLETE", `Prerequisite '${prerequisite}' for task '${task.node.id}' is not completed`);
            }
        }
    }
    transition(record, taskId, status, error) {
        const current = record.nodes.get(taskId);
        if (!current) {
            throw new SpatialBusError("SPATIAL_BUS_MISSING_NODE", `Task '${taskId}' does not exist`);
        }
        this.assertTransition(current.status, status);
        const next = Object.freeze({
            ...current,
            status,
            sequence: this.nextSequence(),
            ...(error === undefined ? {} : { error }),
            ...(status === "completed"
                ? { completedPrerequisites: Object.freeze([...current.prerequisites]) }
                : {}),
        });
        record.nodes = new Map(record.nodes).set(taskId, next);
        const eventType = this.eventTypeFor(status);
        this.emit(record, eventType, next);
    }
    assertTransition(current, next) {
        const allowed = {
            pending: ["queued"],
            queued: ["executing", "failed"],
            executing: ["completed", "failed"],
            completed: [],
            failed: [],
        };
        if (!allowed[current].includes(next)) {
            throw new SpatialBusError("SPATIAL_BUS_INVALID_TRANSITION", `Invalid spatial state transition '${current}' -> '${next}'`);
        }
    }
    taskForState(state) {
        return {
            node: {
                id: state.taskId,
                title: state.taskId,
                description: "",
                agentType: "runtime",
                dependencies: [...state.prerequisites],
                constraints: [],
            },
            prerequisites: [...state.prerequisites],
            dependents: [],
        };
    }
    eventTypeFor(status) {
        switch (status) {
            case "queued":
                return "node:queued";
            case "executing":
                return "node:executing";
            case "completed":
                return "node:completed";
            case "failed":
                return "node:failed";
            default:
                throw new SpatialBusError("SPATIAL_BUS_INVALID_TRANSITION", `Unsupported event state '${status}'`);
        }
    }
    emit(record, type, state, error) {
        const sequence = this.nextSequence();
        const event = Object.freeze({
            id: `${record.namespace}:${record.executionId}:${sequence}`,
            sequence,
            type,
            executionId: record.executionId,
            namespace: record.namespace,
            ...(state ? { taskId: state.taskId, phase: state.phase, state: this.snapshot(state) } : {}),
            ...(error ? { error } : {}),
        });
        record.stream.emit(event);
    }
    snapshot(state) {
        if (!state) {
            throw new SpatialBusError("SPATIAL_BUS_MISSING_NODE", "Task state disappeared during atomic transition");
        }
        return Object.freeze({
            ...state,
            prerequisites: Object.freeze([...state.prerequisites]),
            completedPrerequisites: Object.freeze([...state.completedPrerequisites]),
        });
    }
    getExecution(executionId) {
        const record = this.#executions.get(this.executionKey(executionId));
        if (!record) {
            throw new SpatialBusError("SPATIAL_BUS_EXECUTION_CLOSED", `Execution '${executionId}' is not active in namespace '${this.#namespace}'`);
        }
        return record;
    }
    executionKey(executionId) {
        return `${this.#namespace}\u0000${executionId}`;
    }
    nextSequence() {
        this.#sequence += 1;
        return this.#sequence;
    }
}
//# sourceMappingURL=spatial-bus.js.map