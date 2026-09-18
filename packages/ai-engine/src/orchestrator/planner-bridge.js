import { ImmutableTaskStateStore, PlannerBridgeError, } from "../types/planner-bridge.types.js";
const TERMINAL_STATUSES = new Set(["completed", "failed"]);
export class PlannerBridge {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    bridge(plan) {
        this.validatePlan(plan);
        const executionId = this.options.executionId ?? "planner-execution";
        const namespace = this.options.namespace ?? "klyn";
        const nodeMap = new Map(plan.nodes.map((node) => [node.id, node]));
        const batches = this.buildBatches(plan, nodeMap);
        const states = [];
        for (const batch of batches) {
            for (const task of batch.tasks) {
                states.push([
                    task.node.id,
                    {
                        taskId: task.node.id,
                        status: "pending",
                        phase: batch.phase,
                        prerequisites: task.prerequisites,
                        completedPrerequisites: [],
                        executionId,
                        namespace,
                        stateVersion: 1,
                    },
                ]);
            }
        }
        return Object.freeze({
            executionId,
            namespace,
            batches: Object.freeze(batches),
            taskStates: new ImmutableTaskStateStore(states),
            executionOrder: Object.freeze(plan.executionOrder.slice()),
        });
    }
    synchronizeState(result, update) {
        const current = result.taskStates.get(update.taskId);
        if (current === undefined) {
            throw new PlannerBridgeError("PLANNER_BRIDGE_MISSING_NODE", `Cannot synchronize unknown task: ${update.taskId}`);
        }
        if (current.stateVersion !== update.expectedStateVersion) {
            throw new PlannerBridgeError("PLANNER_BRIDGE_STALE_STATE", `Stale planner state for ${update.taskId}: expected version ${update.expectedStateVersion}, current version ${current.stateVersion}`);
        }
        this.validateTransition(current, update.status, result.taskStates.values());
        const completedPrerequisites = current.prerequisites.filter((prerequisite) => result.taskStates.get(prerequisite)?.status === "completed");
        const nextState = {
            ...current,
            status: update.status,
            completedPrerequisites,
            stateVersion: current.stateVersion + 1,
        };
        return Object.freeze({
            ...result,
            taskStates: result.taskStates.withState(update.taskId, nextState),
        });
    }
    validatePlan(plan) {
        if (plan === null || typeof plan !== "object" || !Array.isArray(plan.nodes)) {
            throw new PlannerBridgeError("PLANNER_BRIDGE_INVALID_PLAN", "Planner bridge requires a valid task graph plan.");
        }
        const nodeIds = new Set(plan.nodes.map((node) => node.id));
        for (const edge of plan.edges) {
            if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
                throw new PlannerBridgeError("PLANNER_BRIDGE_MISSING_NODE", `Plan edge references an unmapped node: ${edge.from} -> ${edge.to}`);
            }
        }
        for (const node of plan.nodes) {
            for (const prerequisite of node.dependencies) {
                if (!nodeIds.has(prerequisite)) {
                    throw new PlannerBridgeError("PLANNER_BRIDGE_MISSING_PREREQUISITE", `Task ${node.id} references an unmapped prerequisite: ${prerequisite}`);
                }
            }
        }
        const positions = new Map(plan.executionOrder.map((id, index) => [id, index]));
        if (positions.size !== nodeIds.size) {
            throw new PlannerBridgeError("PLANNER_BRIDGE_INVALID_PLAN", "Execution order does not cover every task node.");
        }
        for (const edge of plan.edges) {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (from === undefined || to === undefined || from >= to) {
                throw new PlannerBridgeError("PLANNER_BRIDGE_CYCLE", "Plan violates the topological execution invariant.");
            }
        }
    }
    buildBatches(plan, nodeMap) {
        const remaining = new Set(plan.nodes.map((node) => node.id));
        const completed = new Set();
        const batches = [];
        let phase = 1;
        while (remaining.size > 0) {
            const ready = [...remaining]
                .filter((id) => {
                const prerequisites = plan.dependencyMap.prerequisites.get(id);
                if (prerequisites === undefined) {
                    throw new PlannerBridgeError("PLANNER_BRIDGE_MISSING_NODE", `No dependency mapping exists for task: ${id}`);
                }
                return prerequisites.every((prerequisite) => completed.has(prerequisite));
            })
                .sort();
            if (ready.length === 0) {
                throw new PlannerBridgeError("PLANNER_BRIDGE_CYCLE", "No executable task remains; the plan is cyclic or blocked.");
            }
            const tasks = ready.map((id) => {
                const node = nodeMap.get(id);
                if (node === undefined) {
                    throw new PlannerBridgeError("PLANNER_BRIDGE_MISSING_NODE", `Execution queue references an unknown task: ${id}`);
                }
                const prerequisites = plan.dependencyMap.prerequisites.get(id) ?? [];
                const dependents = plan.dependencyMap.dependents.get(id) ?? [];
                return Object.freeze({
                    node: Object.freeze({
                        ...node,
                        dependencies: Object.freeze([...node.dependencies]),
                        constraints: Object.freeze([...node.constraints]),
                    }),
                    prerequisites: Object.freeze([...prerequisites]),
                    dependents: Object.freeze([...dependents]),
                });
            });
            batches.push(Object.freeze({ phase, tasks: Object.freeze(tasks) }));
            ready.forEach((id) => {
                remaining.delete(id);
                completed.add(id);
            });
            phase += 1;
        }
        return batches;
    }
    validateTransition(current, next, states) {
        if (current.status === next)
            return;
        if (TERMINAL_STATUSES.has(current.status)) {
            throw new PlannerBridgeError("PLANNER_BRIDGE_INVALID_STATE", `Task ${current.taskId} is already terminal.`);
        }
        if (next === "executing") {
            const unresolved = current.prerequisites.filter((prerequisite) => states.find((state) => state.taskId === prerequisite)?.status !== "completed");
            if (unresolved.length > 0) {
                throw new PlannerBridgeError("PLANNER_BRIDGE_MISSING_PREREQUISITE", `Task ${current.taskId} cannot enter executing; prerequisites remain incomplete: ${unresolved.join(", ")}`);
            }
        }
        const allowed = {
            pending: ["queued"],
            queued: ["executing", "failed"],
            executing: ["completed", "failed"],
            completed: [],
            failed: [],
        };
        if (!allowed[current.status].includes(next)) {
            throw new PlannerBridgeError("PLANNER_BRIDGE_INVALID_STATE", `Invalid task state transition: ${current.status} -> ${next}`);
        }
    }
}
//# sourceMappingURL=planner-bridge.js.map