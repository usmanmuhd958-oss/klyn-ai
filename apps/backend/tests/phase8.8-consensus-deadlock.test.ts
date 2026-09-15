import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AgentConsensusEngine,
  DeadlockDetector,
  SelfHealingStateResolver,
} from "../../../packages/cognitive-engine/src/index.ts";

test("phase 8.8 reaches quorum and rejects split-brain without majority", () => {
  const consensus = new AgentConsensusEngine<{ status: string }>(5);
  assert.equal(consensus.quorumSize, 3);
  consensus.beginProposal({ term: 7, revision: 12, state: { status: "running" } });
  consensus.castVote({ nodeId: "n1", term: 7, revision: 12, state: { status: "running" } });
  consensus.castVote({ nodeId: "n2", term: 7, revision: 12, state: { status: "paused" } });
  consensus.castVote({ nodeId: "n3", term: 7, revision: 12, state: { status: "running" } });
  consensus.castVote({ nodeId: "n4", term: 7, revision: 12, state: { status: "paused" } });
  assert.equal(consensus.decide(), undefined);
  consensus.castVote({ nodeId: "n5", term: 7, revision: 12, state: { status: "running" } });
  const decision = consensus.decide();
  assert.deepEqual(decision?.voters, ["n1", "n3", "n5"]);
  assert.equal(decision?.revision, 12);
});

test("phase 8.8 enforces monotonic consensus terms", () => {
  const consensus = new AgentConsensusEngine<string>(3);
  consensus.beginProposal({ term: 4, revision: 1, state: "stable" });
  assert.throws(() => consensus.beginProposal({ term: 3, revision: 2, state: "stale" }), /Stale consensus term/);
  assert.throws(() => consensus.castVote({ nodeId: "n1", term: 2, revision: 1, state: "stale" }), /Stale consensus term/);
});

test("phase 8.8 detects wait-for cycles deterministically", () => {
  const detector = new DeadlockDetector();
  const cycles = detector.detect([
    { waiter: "agent-b", holder: "agent-c", resource: "lock-2" },
    { waiter: "agent-c", holder: "agent-a", resource: "lock-3" },
    { waiter: "agent-a", holder: "agent-b", resource: "lock-1" },
  ]);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].participants, ["agent-a", "agent-b", "agent-c"]);
});

test("phase 8.8 self-heals by deterministic lock eviction and state rewind", async () => {
  const calls: string[] = [];
  const resolver = new SelfHealingStateResolver({
    evictLock: (agentId) => calls.push(`evict:${agentId}`),
    rewind: (state) => calls.push(`rewind:${state.revision}`),
  });
  const result = await resolver.resolve(
    { participants: ["agent-c", "agent-a", "agent-b"], edges: [] },
    { revision: 9, value: { checkpoint: "safe" } },
  );
  assert.equal(result.victim, "agent-c");
  assert.deepEqual(calls, ["evict:agent-c", "rewind:9"]);
  assert.equal(result.rewound, true);
});
