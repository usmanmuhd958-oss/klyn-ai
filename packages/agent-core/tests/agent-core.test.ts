import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentDAGScheduler } from "../src/dag-scheduler.js";
import { ContextLedger, canonicalSerializeContext } from "../src/context-ledger.js";
import type { AgentTaskContext } from "../src/contracts.js";

const node = (
  id: string,
  dependsOn: readonly string[] = [],
  run: (attempt: number) => Promise<void> = async () => undefined,
  writePath = `${id}.ts`,
) => ({
  id,
  agentId: `agent-${id}`,
  role: "coder" as const,
  dependsOn,
  readPaths: [writePath],
  writePaths: [writePath],
  maxRetries: 2,
  run: async (_context: AgentTaskContext, attempt: number) => run(attempt),
});

describe("ContextLedger", () => {
  it("preserves anchors and audit hashes through bounded windows", () => {
    const ledger = new ContextLedger();
    ledger.append({
      kind: "tool-result",
      sourceId: "call-1",
      content: "x".repeat(400),
      anchors: [{ kind: "symbol", label: "compileProject", start: 100, end: 140 }],
      auditHash: "audit-1",
    });
    const window = ledger.buildWindow(220);
    assert.equal(window.entries.length, 1);
    assert.equal(window.entries[0]?.truncated, true);
    assert.deepEqual(window.entries[0]?.anchors, [{ kind: "symbol", label: "compileProject", start: 100, end: 140 }]);
    assert.equal(window.entries[0]?.auditHash, "audit-1");
    assert.equal(canonicalSerializeContext(window), canonicalSerializeContext(window));
  });
});

describe("AgentDAGScheduler", () => {
  it("executes dependencies in deterministic ready order", async () => {
    const order: string[] = [];
    const scheduler = new AgentDAGScheduler({ maxConcurrency: 2 });
    const result = await scheduler.run({
      runId: "run-1",
      intentId: "intent-1",
      nodes: [
        node("b", ["a"], async () => { order.push("b"); }),
        node("a", [], async () => { order.push("a"); }),
        node("c", ["a"], async () => { order.push("c"); }),
      ],
    });
    assert.equal(result.completed, true);
    assert.deepEqual(result.states.map((entry) => entry.status), ["succeeded", "succeeded", "succeeded"]);
    assert.deepEqual(order.slice(0, 1), ["a"]);
  });

  it("retries stale CAS conflicts on overlapping paths and requests re-planning", async () => {
    let attempts = 0;
    let replans = 0;
    const scheduler = new AgentDAGScheduler({
      maxConcurrency: 2,
      replanOnStaleRevision: async ({ node: conflictedNode }) => {
        replans += 1;
        assert.equal(conflictedNode.writePaths[0], "shared.ts");
      },
    });
    const result = await scheduler.run({
      runId: "run-race",
      intentId: "intent-race",
      nodes: [
        node("writer-a", [], async () => undefined, "shared.ts"),
        node("writer-b", [], async (attempt) => {
          attempts = attempt;
          if (attempt === 1) throw new Error("Stale file revision for shared.ts: expected old, observed new");
        }, "shared.ts"),
      ],
    });
    assert.equal(result.completed, true);
    assert.equal(attempts, 2);
    assert.equal(replans, 1);
  });
});
