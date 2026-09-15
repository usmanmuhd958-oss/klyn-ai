import { strict as assert } from "node:assert";
import test from "node:test";
import { PlannerBridge } from "../../src/orchestrator/planner-bridge.js";
import { PlannerBridgeError, type PlannerBridgeResult } from "../../src/types/planner-bridge.types.js";
import type { ExecutionDependencyMap, TaskGraphNode, TaskGraphPlan, TaskEdge } from "../../src/types/task-graph.types.js";

const node = (id: string, dependencies: readonly string[] = []): TaskGraphNode => ({ id, title: id, description: `Task ${id}`, agentType: "general", dependencies, constraints: [] });

const planOf = (nodes: readonly TaskGraphNode[], executionOrder: readonly string[]): TaskGraphPlan => {
  const prerequisites = new Map<string, readonly string[]>();
  const dependents = new Map<string, readonly string[]>();
  for (const task of nodes) {
    prerequisites.set(task.id, Object.freeze(task.dependencies.slice()));
    dependents.set(task.id, Object.freeze([]));
  }
  for (const task of nodes) {
    for (const prerequisite of task.dependencies) dependents.set(prerequisite, Object.freeze([...(dependents.get(prerequisite) ?? []), task.id]));
  }
  const dependencyMap: ExecutionDependencyMap = { prerequisites, dependents };
  const edges: TaskEdge[] = nodes.flatMap((task) => task.dependencies.map((from) => ({ from, to: task.id })));
  return { nodes, edges, dependencyMap, executionOrder };
};

const linearPlan = (): TaskGraphPlan => planOf([node("a"), node("b", ["a"]), node("c", ["b"])], ["a", "b", "c"]);
const parallelPlan = (): TaskGraphPlan => planOf([node("a"), node("b"), node("c", ["a", "b"]), node("d", ["a"])], ["a", "b", "c", "d"]);

function next(result: PlannerBridgeResult, taskId: string, status: "queued" | "executing" | "completed"): PlannerBridgeResult {
  const state = result.taskStates.get(taskId);
  assert.ok(state);
  return new PlannerBridge().synchronizeState(result, { taskId, status, expectedStateVersion: state?.stateVersion ?? -1 });
}

test("creates deterministic multi-stage DAG batches", () => {
  const result = new PlannerBridge().bridge(parallelPlan());
  assert.deepEqual(result.batches.map((batch) => batch.tasks.map((task) => task.node.id)), [["a", "b"], ["c", "d"]]);
});

test("initializes canonical pending state at version one", () => {
  const result = new PlannerBridge({ executionId: "exec-2", namespace: "planner" }).bridge(linearPlan());
  assert.equal(result.taskStates.get("a")?.status, "pending");
  assert.equal(result.taskStates.get("b")?.status, "pending");
  assert.equal(result.taskStates.get("b")?.phase, 2);
  assert.equal(result.taskStates.get("b")?.stateVersion, 1);
});

test("enforces the exact canonical lifecycle", () => {
  let result = new PlannerBridge().bridge(linearPlan());
  result = next(result, "a", "queued");
  result = next(result, "a", "executing");
  result = next(result, "a", "completed");
  assert.equal(result.taskStates.get("a")?.status, "completed");
  assert.throws(() => new PlannerBridge().synchronizeState(result, { taskId: "a", status: "executing", expectedStateVersion: 4 }), (error: unknown) => error instanceof PlannerBridgeError && error.code === "PLANNER_BRIDGE_INVALID_STATE");
});

test("rejects dependent execution until prerequisites are completed", () => {
  const result = new PlannerBridge().bridge(linearPlan());
  assert.throws(() => new PlannerBridge().synchronizeState(result, { taskId: "b", status: "executing", expectedStateVersion: 1 }), (error: unknown) => error instanceof PlannerBridgeError && error.code === "PLANNER_BRIDGE_MISSING_PREREQUISITE");
});

test("replaces immutable snapshots without mutating the source", () => {
  const bridge = new PlannerBridge();
  const initial = bridge.bridge(linearPlan());
  const updated = bridge.synchronizeState(initial, { taskId: "a", status: "queued", expectedStateVersion: 1 });
  assert.notEqual(updated.taskStates, initial.taskStates);
  assert.equal(initial.taskStates.get("a")?.status, "pending");
  assert.equal(updated.taskStates.get("a")?.status, "queued");
  const state = updated.taskStates.get("a");
  assert.ok(state);
  const prerequisites = [...(state?.prerequisites ?? [])];
  prerequisites.push("tampered");
  assert.deepEqual(updated.taskStates.get("a")?.prerequisites, []);
});

test("rejects stale competing snapshots deterministically", async () => {
  const bridge = new PlannerBridge();
  const initial = bridge.bridge(linearPlan());
  const results = await Promise.allSettled([
    Promise.resolve().then(() => bridge.synchronizeState(initial, { taskId: "a", status: "queued", expectedStateVersion: 1 })),
    Promise.resolve().then(() => bridge.synchronizeState(initial, { taskId: "a", status: "queued", expectedStateVersion: 1 })),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal(results.filter((result) => result.status === "rejected").length, 0);
  const first = results[0];
  assert.equal(first.status, "fulfilled");
  if (first.status === "fulfilled") {
    assert.equal(first.value.taskStates.get("a")?.stateVersion, 2);
    assert.throws(() => bridge.synchronizeState(first.value, { taskId: "a", status: "executing", expectedStateVersion: 1 }), (error: unknown) => error instanceof PlannerBridgeError && error.code === "PLANNER_BRIDGE_STALE_STATE");
  }
});

test("rejects malformed plans", () => {
  const invalid: TaskGraphPlan = {
    nodes: [node("a", ["missing"])],
    edges: [],
    dependencyMap: { prerequisites: new Map([["a", ["missing"]]]), dependents: new Map([["a", []]]) },
    executionOrder: ["a"],
  };
  assert.throws(() => new PlannerBridge().bridge(invalid), (error: unknown) => error instanceof PlannerBridgeError && error.code === "PLANNER_BRIDGE_MISSING_PREREQUISITE");
});
