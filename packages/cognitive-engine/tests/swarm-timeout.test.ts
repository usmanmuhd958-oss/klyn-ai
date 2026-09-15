import assert from "node:assert/strict";
import test from "node:test";
import { DagTimeoutError, deterministicIdempotencyKey, SwarmDagOrchestrator } from "../src/swarm/DagOrchestrator.js";

test("idempotency key is deterministic", () => {
  const task = { id: "a", agentId: "agent", input: { x: 1 }, dependsOn: ["b"] };
  assert.equal(deterministicIdempotencyKey(task), deterministicIdempotencyKey({ ...task }));
});

test("timeout aborts the swarm and rolls back completed work", async () => {
  let rolled = false;
  const dag = new SwarmDagOrchestrator()
    .addTask({ id: "fast", agentId: "a", input: null, run: async () => 1, rollback: async () => { rolled = true; } })
    .addTask({ id: "slow", agentId: "b", input: null, dependsOn: ["fast"], run: async (_context, signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve("late"), 100);
      timer.unref();
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      }, { once: true });
    }) });

  await assert.rejects(dag.execute({ timeoutMs: 10 }), DagTimeoutError);
  assert.equal(rolled, true);
});

test("external cancellation propagates to running task", async () => {
  const controller = new AbortController();
  const dag = new SwarmDagOrchestrator().addTask({ id: "a", agentId: "a", input: null, run: async (_context, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("late"), 100);
    timer.unref();
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  }) });
  const promise = dag.execute({ signal: controller.signal });
  const abortTimer = setTimeout(() => controller.abort(), 5);
  abortTimer.unref();
  await assert.rejects(promise);
});
