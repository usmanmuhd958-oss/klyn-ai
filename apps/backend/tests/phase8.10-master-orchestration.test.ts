import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentEventBus,
  AgentConsensusEngine,
  DeadlockDetector,
  SelfHealingStateResolver,
} from "../../../packages/cognitive-engine/src/index.ts";
import {
  ContextEmbeddingEngine,
  CrossAgentKnowledgeBus,
  DeterministicEmbeddingProvider,
  VectorMemoryIndex,
} from "@klyn/ai-engine";
import { MasterExecutionOrchestrator } from "../src/master-execution-orchestrator.js";

function buildHarness() {
  const bus = new AgentEventBus();
  const events = {
    publish: (topic: string, payload: unknown) => bus.publish(topic as never, payload as never),
  };
  const embeddings = new ContextEmbeddingEngine(new DeterministicEmbeddingProvider(32));
  const memory = new CrossAgentKnowledgeBus(embeddings, new VectorMemoryIndex<{ source: string }>(32, 100));
  const consensus = new AgentConsensusEngine<{ revision: number }>(3);
  const detector = new DeadlockDetector();
  const released: string[] = [];
  const resolver = new SelfHealingStateResolver<{ revision: number }>({
    evictLock: (agentId) => released.push(agentId),
    rewind: () => undefined,
  });
  return { bus, orchestrator: new MasterExecutionOrchestrator(events, memory, consensus, detector, resolver), released };
}

test("P8.10 end-to-end orchestration is green with consensus and no deadlock", async () => {
  const { bus, orchestrator } = buildHarness();
  const topics: string[] = [];
  bus.subscribe((topic) => topic as never, (event) => topics.push(event.topic));

  const result = await orchestrator.execute({
    executionId: "exec-green",
    namespace: "agent-a",
    context: "recover the worker after a database restart",
    proposal: { term: 1, revision: 7, state: { revision: 7 } },
    votes: [
      { nodeId: "node-a", term: 1, revision: 7, state: { revision: 7 } },
      { nodeId: "node-b", term: 1, revision: 7, state: { revision: 7 } },
    ],
    dependencies: [],
    safeState: { revision: 6, value: { revision: 6 } },
    memoryPayload: { source: "integration" },
    now: 1000,
  });

  assert.equal(result.completed, true);
  assert.equal(result.consensus?.revision, 7);
  assert.equal(result.deadlocks.length, 0);
  assert.equal(result.recoveries.length, 0);
  assert.equal(result.memory.length, 1);
  assert.deepEqual(topics, ["master.execution.dispatched", "master.execution.completed"]);
});

test("P8.10 resolves a detected deadlock after consensus", async () => {
  const { orchestrator, released } = buildHarness();
  const result = await orchestrator.execute({
    executionId: "exec-recovery",
    namespace: "agent-a",
    context: "restore state after a worker lock cycle",
    proposal: { term: 2, revision: 8, state: { revision: 8 } },
    votes: [
      { nodeId: "node-a", term: 2, revision: 8, state: { revision: 8 } },
      { nodeId: "node-b", term: 2, revision: 8, state: { revision: 8 } },
    ],
    dependencies: [
      { waiter: "agent-a", holder: "agent-b", resource: "lock-a" },
      { waiter: "agent-b", holder: "agent-a", resource: "lock-b" },
    ],
    safeState: { revision: 7, value: { revision: 7 } },
    memoryPayload: { source: "recovery" },
    now: 2000,
  });

  assert.equal(result.completed, true);
  assert.equal(result.deadlocks.length, 1);
  assert.equal(result.recoveries.length, 1);
  assert.deepEqual(released, ["agent-b"]);
  assert.equal(result.recoveries[0]?.rewound, true);
});

test("P8.10 fails closed when consensus has no quorum", async () => {
  const { orchestrator } = buildHarness();
  const result = await orchestrator.execute({
    executionId: "exec-blocked",
    namespace: "agent-a",
    context: "wait for additional consensus",
    proposal: { term: 3, revision: 9, state: { revision: 9 } },
    votes: [{ nodeId: "node-a", term: 3, revision: 9, state: { revision: 9 } }],
    dependencies: [],
    safeState: { revision: 8, value: { revision: 8 } },
    memoryPayload: { source: "blocked" },
    now: 3000,
  });

  assert.equal(result.completed, false);
  assert.equal(result.consensus, undefined);
  assert.equal(result.deadlocks.length, 0);
});
