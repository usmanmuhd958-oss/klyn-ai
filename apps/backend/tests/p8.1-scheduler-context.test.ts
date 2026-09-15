import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SqliteAgentEventStore, LeaseScheduler } from "@klyn/execution-runtime";
import { ReadyQueue, SwarmDagOrchestrator } from "../../../packages/cognitive-engine/src/index.ts";
import { ContextBudgetManager, ContextCompactor, ContextControlPlane, distillSubagentResult } from "@klyn/ai-engine";

describe("Klyn Phase 8.1", () => {
  it("atomically fences workers and recovers expired leases", async () => {
    const root = await mkdtemp(join(tmpdir(), "klyn-p81-"));
    const store = await SqliteAgentEventStore.open(join(root, "execution.sqlite"));
    try {
      const a = new LeaseScheduler(store, "worker-a", { defaultLeaseMs: 100 });
      const b = new LeaseScheduler(store, "worker-b", { defaultLeaseMs: 100 });
      await a.enqueue({ idempotencyKey: "lease-1", payload: { ok: true } });
      const first = await a.claim<{ ok: boolean }>();
      assert.ok(first?.fencingToken);
      assert.equal((await b.claim()), undefined);
      assert.equal((await a.heartbeat({ taskId: first!.id, fencingToken: first!.fencingToken! }))?.workerId, "worker-a");
      await a.reapNow(Date.now() + 200);
      const second = await b.claim<{ ok: boolean }>();
      assert.ok(second?.fencingToken && second.fencingToken > first!.fencingToken!);
      assert.equal(await a.complete(first!), undefined);
      assert.equal((await b.complete(second!))?.status, "COMPLETED");
    } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("dispatches newly-ready DAG nodes without layer barriers", async () => {
    const started: string[] = [];
    const dag = new SwarmDagOrchestrator();
    dag.addTasks([
      { id: "a", agentId: "a", input: null, run: async () => { started.push("a"); await new Promise(r => setTimeout(r, 25)); return "a"; } },
      { id: "b", agentId: "b", input: null, run: async () => { started.push("b"); return "b"; } },
      { id: "c", agentId: "c", input: null, dependsOn: ["a"], run: async () => { started.push("c"); return "c"; } },
    ]);
    const snapshot = await dag.execute({ maxConcurrency: 2 });
    assert.equal(snapshot.statuses.c, "succeeded");
    assert.ok(started.indexOf("c") > started.indexOf("a"));
  });

  it("keeps ReadyQueue ordering deterministic", () => {
    const q = new ReadyQueue([{ id: "b", dependsOn: [] }, { id: "a", dependsOn: [] }, { id: "c", dependsOn: ["a", "b"] }]);
    assert.deepEqual(q.drain().map(t => t.id), ["a", "b"]);
    assert.deepEqual(q.complete("a").map(t => t.id), []);
    assert.deepEqual(q.complete("b").map(t => t.id), ["c"]);
  });

  it("compacts context and distills subagent state into notes", () => {
    const manager = new ContextControlPlane(new ContextBudgetManager({ maxTokens: 50, reserveTokens: 5, compactAtRatio: 0.5 }), new ContextCompactor(2));
    manager.addNote({ id: "d1", kind: "decision", content: "Use fenced leases" });
    const snapshot = manager.snapshot([
      { role: "user", content: "one long execution message that consumes budget" },
      { role: "assistant", content: "another execution message that consumes budget" },
      { role: "tool", content: "recent result" },
    ]);
    assert.equal(snapshot.compacted, true);
    assert.equal(snapshot.messages[0]?.role, "summary");
    const notes = distillSubagentResult({ taskId: "agent-1", outcome: "failed", summary: "verification pending", unresolved: ["CI"] });
    assert.equal(notes[0]?.kind, "unresolved");
    assert.equal(notes.length, 2);
  });
});
