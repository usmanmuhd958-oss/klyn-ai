import assert from "node:assert/strict";
import test from "node:test";
import { DagValidationError, SwarmDagOrchestrator } from "../src/swarm/DagOrchestrator.js";

test("topological sort is deterministic and detects cycles at validation time", () => {
  const dag = new SwarmDagOrchestrator()
    .addTask({ id: "z", agentId: "agent-z", input: null, dependsOn: ["a"], run: async () => "z" })
    .addTask({ id: "a", agentId: "agent-a", input: null, run: async () => "a" })
    .addTask({ id: "m", agentId: "agent-m", input: null, run: async () => "m" });

  assert.deepEqual(dag.topologicalSort(), [["a", "m"], ["z"]]);

  const cyclic = new SwarmDagOrchestrator()
    .addTask({ id: "a", agentId: "a", input: null, dependsOn: ["b"], run: async () => 1 })
    .addTask({ id: "b", agentId: "b", input: null, dependsOn: ["a"], run: async () => 2 });

  assert.throws(() => cyclic.validate(), DagValidationError);
  assert.throws(() => cyclic.execute(), DagValidationError);
});

test("independent agents execute in parallel up to maxConcurrency and children wait for parents", async () => {
  let active = 0;
  let peak = 0;
  const starts: string[] = [];
  const finish = async (id: string) => {
    starts.push(id);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active -= 1;
    return id;
  };

  const dag = new SwarmDagOrchestrator()
    .addTask({ id: "a", agentId: "a", input: null, run: async () => finish("a") })
    .addTask({ id: "b", agentId: "b", input: null, run: async () => finish("b") })
    .addTask({ id: "c", agentId: "c", input: null, dependsOn: ["a", "b"], run: async () => finish("c") });

  const snapshot = await dag.execute({ maxConcurrency: 2 });
  assert.equal(peak, 2);
  assert.deepEqual(starts.slice(0, 2).sort(), ["a", "b"]);
  assert.equal(starts[2], "c");
  assert.deepEqual(snapshot.statuses, { a: "succeeded", b: "succeeded", c: "succeeded" });
  assert.deepEqual(snapshot.outputs, { a: "a", b: "b", c: "c" });
});

test("fail-safe execution isolates a failed parent and skips only downstream dependents", async () => {
  const ran: string[] = [];
  const dag = new SwarmDagOrchestrator()
    .addTask({ id: "root-fail", agentId: "a", input: null, run: async () => { ran.push("root-fail"); throw new Error("parent failed"); } })
    .addTask({ id: "root-ok", agentId: "b", input: null, run: async () => { ran.push("root-ok"); return "ok"; } })
    .addTask({ id: "child", agentId: "c", input: null, dependsOn: ["root-fail"], run: async () => { ran.push("child"); return "child"; } })
    .addTask({ id: "grandchild", agentId: "d", input: null, dependsOn: ["child"], run: async () => { ran.push("grandchild"); return "grandchild"; } })
    .addTask({ id: "independent", agentId: "e", input: null, run: async () => { ran.push("independent"); return "independent"; } });

  const snapshot = await dag.execute({ failFast: false, maxConcurrency: 2 });
  assert.equal(snapshot.statuses["root-fail"], "failed");
  assert.equal(snapshot.statuses["root-ok"], "succeeded");
  assert.equal(snapshot.statuses.child, "skipped");
  assert.equal(snapshot.statuses.grandchild, "skipped");
  assert.equal(snapshot.statuses.independent, "succeeded");
  assert.ok(!ran.includes("child"));
  assert.ok(!ran.includes("grandchild"));
});

test("duplicate and unknown dependencies are rejected before any agent runs", () => {
  assert.throws(
    () => new SwarmDagOrchestrator()
      .addTask({ id: "a", agentId: "a", input: null, run: async () => 1 })
      .addTask({ id: "a", agentId: "b", input: null, run: async () => 2 }),
    DagValidationError,
  );

  assert.throws(
    () => new SwarmDagOrchestrator()
      .addTask({ id: "a", agentId: "a", input: null, dependsOn: ["missing"], run: async () => 1 })
      .validate(),
    DagValidationError,
  );
});
