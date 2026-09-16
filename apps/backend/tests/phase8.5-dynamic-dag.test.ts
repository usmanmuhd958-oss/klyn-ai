import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GraphExecutionEngine, TaskGraphBuilder, TopologicalResolver, type GraphExecutionTask } from "../../../packages/cognitive-engine/src/index.ts";
import { DependencyExecutionPlanner, type PlannedTask } from "../../../packages/execution-runtime/src/index.ts";

test("phase 8.5 rejects cyclic graphs before execution", () => {
  const tasks = new TaskGraphBuilder().addMany([
    { id: "a", dependsOn: ["c"] },
    { id: "b", dependsOn: ["a"] },
    { id: "c", dependsOn: ["b"] },
  ]).build();
  assert.throws(() => new TopologicalResolver().resolve(tasks), /DAG cycle detected/);
});

test("phase 8.5 resolves deterministic parallel layers", () => {
  const tasks = new TaskGraphBuilder().addMany([
    { id: "deploy", dependsOn: ["build", "test"] },
    { id: "test", dependsOn: ["prepare"] },
    { id: "build", dependsOn: ["prepare"] },
    { id: "prepare" },
  ]).build();
  const resolved = new TopologicalResolver().resolve(tasks);
  assert.deepEqual(resolved.layers.map((layer) => layer.map((task) => task.id)), [["prepare"], ["build", "test"], ["deploy"]]);
  assert.deepEqual(resolved.order, ["prepare", "build", "test", "deploy"]);
});

test("phase 8.5 isolates failed nodes and rolls back completed work", async () => {
  const rolledBack: string[] = [];
  const tasks: GraphExecutionTask[] = [
    { id: "a", run: async () => "A", rollback: async () => { rolledBack.push("a"); } },
    { id: "b", run: async () => { throw new Error("boom"); } },
    { id: "c", dependsOn: ["b"], run: async () => "C" },
    { id: "d", dependsOn: ["a"], run: async () => "D" },
  ];
  await assert.rejects(() => new GraphExecutionEngine().execute(tasks, { maxConcurrency: 2 }), /Graph execution failed/);
  assert.deepEqual(rolledBack, ["a"]);
});

test("phase 8.5 runtime planner executes independent tasks concurrently and fences dependents after failure", async () => {
  const started: string[] = [];
  const tasks: PlannedTask[] = [
    { id: "a", execute: async () => { started.push("a"); await new Promise((resolve) => globalThis.setTimeout(resolve, 5)); return "A"; } },
    { id: "b", execute: async () => { started.push("b"); await new Promise((resolve) => globalThis.setTimeout(resolve, 5)); throw new Error("failure"); } },
    { id: "c", dependsOn: ["b"], execute: async () => { started.push("c"); return "C"; } },
    { id: "d", dependsOn: ["a"], execute: async () => { started.push("d"); return "D"; } },
  ];
  const result = await new DependencyExecutionPlanner().execute(tasks, { maxConcurrency: 2 });
  assert.deepEqual(started.slice(0, 2).sort(), ["a", "b"]);
  assert.deepEqual(result.failed, ["b"]);
  assert.deepEqual(result.skipped, ["c"]);
  assert.deepEqual(result.completed, ["a"]);
});
