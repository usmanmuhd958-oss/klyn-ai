import type { TaskGraphPlan, TaskGraphNode } from "../types/task-graph.types.js";
import {
  PlannerBridgeError,
  type ExecutableTask,
  type ExecutableTaskBatch,
  type PlannerBridgeOptions,
  type PlannerBridgeResult,
  type PlannerBridgeStateUpdate,
  type PlannerRuntimeTaskState,
  type PlannerTaskStatus,
} from "../types/planner-bridge.types.js";

const TERMINAL_STATUSES = new Set<PlannerTaskStatus>(["completed", "failed", "blocked"]);

export class PlannerBridge {
  public constructor(private readonly options: PlannerBridgeOptions = {}) {}

  public bridge(plan: TaskGraphPlan): PlannerBridgeResult {
    this.validatePlan(plan);

    const executionId = this.options.executionId ?? "planner-execution";
    const namespace = this.options.namespace ?? "klyn";
    const nodeMap = new Map<string, TaskGraphNode>(plan.nodes.map((node) => [node.id, node]));
    const batches = this.buildBatches(plan, nodeMap);
    const taskStates = new Map<string, PlannerRuntimeTaskState>();

    for (const batch of batches) {
      for (const task of batch.tasks) {
        taskStates.set(task.node.id, Object.freeze({
          taskId: task.node.id,
          status: task.prerequisites.length === 0 ? "ready" : "pending",
          phase: batch.phase,
          prerequisites: Object.freeze(task.prerequisites.slice()),
          completedPrerequisites: Object.freeze([]),
          executionId,
          namespace,
        }));
      }
    }

    return Object.freeze({
      executionId,
      namespace,
      batches: Object.freeze(batches),
      taskStates,
      executionOrder: Object.freeze(plan.executionOrder.slice()),
    });
  }

  public synchronizeState(
    result: PlannerBridgeResult,
    update: PlannerBridgeStateUpdate,
  ): PlannerBridgeResult {
    const current = result.taskStates.get(update.taskId);
    if (current === undefined) {
      throw new PlannerBridgeError(
        "PLANNER_BRIDGE_MISSING_NODE",
        `Cannot synchronize unknown task: ${update.taskId}`,
      );
    }

    this.validateTransition(current, update.status, result.taskStates);
    const completedPrerequisites = current.prerequisites.filter(
      (prerequisite) => result.taskStates.get(prerequisite)?.status === "completed",
    );
    const nextState = Object.freeze({
      ...current,
      status: update.status,
      completedPrerequisites: Object.freeze(completedPrerequisites),
    });
    const nextStates = new Map(result.taskStates);
    nextStates.set(update.taskId, nextState);

    return Object.freeze({ ...result, taskStates: nextStates });
  }

  private validatePlan(plan: TaskGraphPlan): void {
    if (plan === null || typeof plan !== "object" || !Array.isArray(plan.nodes)) {
      throw new PlannerBridgeError("PLANNER_BRIDGE_INVALID_PLAN", "Planner bridge requires a valid task graph plan.");
    }

    const nodeIds = new Set(plan.nodes.map((node) => node.id));
    for (const edge of plan.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        throw new PlannerBridgeError(
          "PLANNER_BRIDGE_MISSING_NODE",
          `Plan edge references an unmapped node: ${edge.from} -> ${edge.to}`,
        );
      }
    }

    for (const node of plan.nodes) {
      for (const prerequisite of node.dependencies) {
        if (!nodeIds.has(prerequisite)) {
          throw new PlannerBridgeError(
            "PLANNER_BRIDGE_MISSING_PREREQUISITE",
            `Task ${node.id} references an unmapped prerequisite: ${prerequisite}`,
          );
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

  private buildBatches(plan: TaskGraphPlan, nodeMap: ReadonlyMap<string, TaskGraphNode>): ExecutableTaskBatch[] {
    const remaining = new Set(plan.nodes.map((node) => node.id));
    const completed = new Set<string>();
    const batches: ExecutableTaskBatch[] = [];
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

      const tasks: ExecutableTask[] = ready.map((id) => {
        const node = nodeMap.get(id);
        if (node === undefined) {
          throw new PlannerBridgeError("PLANNER_BRIDGE_MISSING_NODE", `Execution queue references an unknown task: ${id}`);
        }
        const prerequisites = plan.dependencyMap.prerequisites.get(id) ?? [];
        const dependents = plan.dependencyMap.dependents.get(id) ?? [];
        return Object.freeze({
          node,
          prerequisites: Object.freeze(prerequisites.slice()),
          dependents: Object.freeze(dependents.slice()),
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

  private validateTransition(
    current: PlannerRuntimeTaskState,
    next: PlannerTaskStatus,
    states: ReadonlyMap<string, PlannerRuntimeTaskState>,
  ): void {
    if (current.status === next) return;
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new PlannerBridgeError("PLANNER_BRIDGE_INVALID_STATE", `Task ${current.taskId} is already terminal.`);
    }

    if (next === "ready" || next === "running") {
      const unresolved = current.prerequisites.filter(
        (prerequisite) => states.get(prerequisite)?.status !== "completed",
      );
      if (unresolved.length > 0) {
        throw new PlannerBridgeError(
          "PLANNER_BRIDGE_MISSING_PREREQUISITE",
          `Task ${current.taskId} cannot enter ${next}; prerequisites remain incomplete: ${unresolved.join(", ")}`,
        );
      }
    }

    const allowed: ReadonlyMap<PlannerTaskStatus, readonly PlannerTaskStatus[]> = new Map([
      ["pending", ["ready", "blocked", "failed"]],
      ["ready", ["running", "blocked", "failed"]],
      ["running", ["completed", "blocked", "failed"]],
    ]);
    if (!(allowed.get(current.status) ?? []).includes(next)) {
      throw new PlannerBridgeError(
        "PLANNER_BRIDGE_INVALID_STATE",
        `Invalid task state transition: ${current.status} -> ${next}`,
      );
    }
  }
}
