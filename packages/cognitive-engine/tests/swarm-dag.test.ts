import test from "node:test";
import assert from "node:assert/strict";
import { DagValidationError, SwarmDagOrchestrator } from "../src/swarm/DagOrchestrator.js";

test("topological sort creates parallel layers", () => {
  const dag = new SwarmDagOrchestrator();
  dag.addTasks([
    { id: "a", agentId: "agent-a", input: 1, run: async () => "a" },
    { id: "b", agentId: "agent-b", input: 2, run: async () => "b" },
    { id: "c", agentId: "agent-c", input: 3, dependsOn: ["a", "b"], run: async ({ outputs }) => `${outputs.a}${outputs.b}` },
  ]);
  assert.deepEqual(dag.topologicalSort(), [["a", "b"], ["c"]]);
});

test("cycle validation fails deterministically", () => {
  const dag = new SwarmDagOrchestrator();
  dag.addTasks([
    { id: "a", agentId: "a", input: null, dependsOn: ["b"], run: async () => null },
    { id: "b", agentId: "b", input: null, dependsOn: ["a"], run: async () => null },
  ]);
  assert.throws(() => dag.validate(), DagValidationError);
});

test("failed execution rolls back completed tasks", async () => {
  const rolledBack: string[] = [];
  const dag = new SwarmDagOrchestrator();
  dag.addTasks([
    { id: "a", agentId: "a", input: null, run: async () => "ok", rollback: async () => { rolledBack.push("a"); } },
    { id: "b", agentId: "b", input: null, dependsOn: ["a"], run: async () => { throw new Error("boom"); } },
  ]);
  await assert.rejects(() => dag.execute(), /boom/);
  assert.deepEqual(rolledBack, ["a"]);
});
