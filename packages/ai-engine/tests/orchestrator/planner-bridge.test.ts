import { strict as assert } from "node:assert";
import test from "node:test";
import { PlannerBridge } from "../../src/orchestrator/planner-bridge.js";
import { PlannerBridgeError, type PlannerBridgeResult } from "../../src/types/planner-bridge.types.js";
import type {
  ExecutionDependencyMap,
  TaskGraphNode,
  TaskGraphPlan,
  TaskEdge,
} from "../../src/types/task-graph.types.js";

const node = (id: string, dependencies: readonly string[] = []): TaskGraphNode => ({
  id,
  title: id,
  description: `Task ${id}`,
  agentType: "general",
  dependencies,
  constraints: [],
});

const planOf = (nodes: readonly TaskGraphNode[], executionOrder: readonly string[]): TaskGraphPlan => {
  const prerequisites = new Map<string, readonly string[]>();
  const dependents = new Map<string, readonly string[]>();
  for (const task of nodes) {
    prerequisites.set(task.id, Object.freeze(task.dependencies.slice()));
    dependents.set(task.id, Object.freeze([]));
  }
  for (const task of nodes) {
    for (const prerequisite of task.dependencies) {
      dependents.set(prerequisite, Object.freeze([...(dependents.get(prerequisite) ?? []), task.id]));
    }
  }
  const dependencyMap: ExecutionDependencyMap = { prerequisites, dependents };
  const edges: TaskEdge[] = nodes.flatMap((task) => task.dependencies.map((from) => ({ from, to: task.id })));
  return { nodes, edges, dependencyMap, executionOrder };
};

const linearPlan = (): TaskGraphPlan => planOf(
  [node("a"), node("b", ["a"]), node("c", ["b"])],
  ["a", "b", "c"],
);

const parallelPlan = (): TaskGraphPlan => planOf(
  [node("a"), node("b"), node("c", ["a", "b"]), node("d", ["a"])],
  ["a", "b", "c", "d"],
);

test("creates one execution phase for independent tasks", () => {
  const plan = planOf([node("a"), node("b"), node("c")], ["a", "b", "c"]);
  const result = new PlannerBridge({ executionId: "exec-1", namespace: "test" }).bridge(plan);

  assert.equal(result.batches.length, 1);
  assert.deepEqual(result.batches[0]?.tasks.map((task) => task.node.id), ["a", "b", "c"]);
  assert.deepEqual(result.executionOrder, ["a", "b", "c"]);
});

test("creates deterministic multi-stage parallel DAG batches", () => {
  const result = new PlannerBridge().bridge(parallelPlan());

  assert.equal(result.batches.length, 3);
  assert.deepEqual(result.batches.map((batch) => batch.tasks.map((task) => task.node.id)), [
    ["a", "b"],
    ["d"],
    ["c"],
  ]);
});

test("preserves topological ordering across every execution batch", () => {
  const result = new PlannerBridge().bridge(parallelPlan());
  const positions = new Map(result.executionOrder.map((id, index) => [id, index]));

  for (const batch of result.batches) {
    for (const task of batch.tasks) {
      for (const prerequisite of task.prerequisites) {
        assert.ok((positions.get(prerequisite) ?? -1) < (positions.get(task.node.id) ?? -1));
      }
    }
  }
});

test("initializes runtime state with dependency-aware readiness", () => {
  const result = new PlannerBridge({ executionId: "exec-2", namespace: "planner" }).bridge(linearPlan());

  assert.equal(result.taskStates.get("a")?.status, "ready");
  assert.equal(result.taskStates.get("b")?.status, "pending");
  assert.equal(result.taskStates.get("c")?.status, "pending");
  assert.equal(result.taskStates.get("b")?.phase, 2);
  assert.equal(result.taskStates.get("b")?.executionId, "exec-2");
  assert.equal(result.taskStates.get("b")?.namespace, "planner");
});

test("synchronizes state only after prerequisites complete", () => {
  const bridge = new PlannerBridge();
  const initial = bridge.bridge(linearPlan());
  const completedA = bridge.synchronizeState(initial, { taskId: "a", status: "running" });
  const completed = bridge.synchronizeState(completedA, { taskId: "a", status: "completed" });
  const readyB = bridge.synchronizeState(completed, { taskId: "b", status: "ready" });

  assert.equal(readyB.taskStates.get("a")?.status, "completed");
  assert.equal(readyB.taskStates.get("b")?.status, "ready");
  assert.deepEqual(readyB.taskStates.get("b")?.completedPrerequisites, ["a"]);
});

test("fails immediately when a task has an unmapped prerequisite", () => {
  const invalid = planOf([node("a", ["missing"])], ["a"]);
  assert.throws(
    () => new PlannerBridge().bridge(invalid),
    (error: unknown) => error instanceof PlannerBridgeError && error.code === "PLANNER_BRIDGE_MISSING_PREREQUISITE",
  );
});

test("fails immediately when an execution edge references an unmapped node", () => {
  const valid = planOf([node("a")], ["a"]);
  const invalid: TaskGraphPlan = {
    ...valid,
    edges: [{ from: "missing", to: "a" }],
  };
  assert.throws(
    () => new PlannerBridge().bridge(invalid),
    (error: unknown) => error instanceof PlannerBridgeError && error.code === "PLANNER_BRIDGE_MISSING_NODE",
  );
});

test("rejects a plan that violates the topological invariant", () => {
  const invalid = planOf([node("a"), node("b", ["a"])], ["b", "a"]);
  assert.throws(
    () => new PlannerBridge().bridge(invalid),
    (error: unknown) => error instanceof PlannerBridgeError && error.code === "PLANNER_BRIDGE_CYCLE",
  );
});

test("rejects an unmapped runtime state update", () => {
  const result = new PlannerBridge().bridge(linearPlan());
  assert.throws(
    () => new PlannerBridge().synchronizeState(result, { taskId: "missing", status: "running" }),
    (error: unknown) => error instanceof PlannerBridgeError && error.code === "PLANNER_BRIDGE_MISSING_NODE",
  );
});

test("enforces prerequisite completion during runtime transition", () => {
  const bridge = new PlannerBridge();
  const result = bridge.bridge(linearPlan());
  assert.throws(
    () => bridge.synchronizeState(result, { taskId: "b", status: "running" }),
    (error: unknown) => error instanceof PlannerBridgeError && error.code === "PLANNER_BRIDGE_MISSING_PREREQUISITE",
  );
});

test("does not mutate the execution queue or source plan", () => {
  const plan = parallelPlan();
  const originalOrder = plan.executionOrder.slice();
  const result = new PlannerBridge().bridge(plan);
  const batchIds = result.batches[0]?.tasks.map((task) => task.node.id) ?? [];

  batchIds.reverse();
  assert.deepEqual(plan.executionOrder, originalOrder);
  assert.deepEqual(result.batches[0]?.tasks.map((task) => task.node.id), ["a", "b"]);
});

test("returns a new state map while preserving the previous result", () => {
  const bridge = new PlannerBridge();
  const result: PlannerBridgeResult = bridge.bridge(linearPlan());
  const updated = bridge.synchronizeState(result, { taskId: "a", status: "running" });

  assert.notEqual(updated.taskStates, result.taskStates);
  assert.equal(result.taskStates.get("a")?.status, "ready");
  assert.equal(updated.taskStates.get("a")?.status, "running");
});
