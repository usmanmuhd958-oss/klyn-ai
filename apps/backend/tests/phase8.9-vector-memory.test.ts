import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ContextEmbeddingEngine,
  CrossAgentKnowledgeBus,
  DeterministicEmbeddingProvider,
  VectorMemoryIndex,
  cosineSimilarity,
} from "../../../packages/ai-engine/src/index.ts";

test("P8.9 cosine similarity and dimension invariants", async () => {
  const engine = new ContextEmbeddingEngine(new DeterministicEmbeddingProvider(32));
  const first = await engine.encode("durable execution recovery");
  const second = await engine.encode("durable execution recovery");
  assert.equal(first.length, 32);
  assert.ok(cosineSimilarity(first, second) > 0.999);
  assert.throws(() => cosineSimilarity([1, 0], [1, 0, 0]), /dimensions/);
});

test("P8.9 flat k-NN ranks relevant memory deterministically", async () => {
  const engine = new ContextEmbeddingEngine(new DeterministicEmbeddingProvider(32));
  const index = new VectorMemoryIndex<{ text: string }>(32, 10);
  const bus = new CrossAgentKnowledgeBus(engine, index);
  await bus.publish({ id: "a", namespace: "agent-a", content: "SQLite recovery after worker crash", payload: { text: "recovery" } });
  await bus.publish({ id: "b", namespace: "agent-a", content: "provider telemetry and token usage", payload: { text: "telemetry" } });
  const result = await bus.query("agent-a", "worker crash recovery", 2);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.id, "a");
  assert.ok((result[0]?.score ?? 0) >= (result[1]?.score ?? 0));
});

test("P8.9 namespace fencing prevents cross-agent retrieval", async () => {
  const engine = new ContextEmbeddingEngine(new DeterministicEmbeddingProvider(32));
  const index = new VectorMemoryIndex<{ owner: string }>(32, 10);
  const bus = new CrossAgentKnowledgeBus(engine, index);
  await bus.publish({ id: "private-a", namespace: "agent-a", content: "secret execution context", payload: { owner: "agent-a" } });
  await bus.publish({ id: "private-b", namespace: "agent-b", content: "secret execution context", payload: { owner: "agent-b" } });
  const result = await bus.query("agent-a", "secret execution context", 10);
  assert.deepEqual(result.map((item) => item.id), ["private-a"]);
});

test("P8.9 expired memory is garbage-collected", async () => {
  const engine = new ContextEmbeddingEngine(new DeterministicEmbeddingProvider(16));
  const index = new VectorMemoryIndex<{ value: number }>(16, 2);
  const bus = new CrossAgentKnowledgeBus(engine, index);
  await bus.publish({ id: "expired", namespace: "agent-a", content: "temporary context", payload: { value: 1 }, ttlMs: 10 }, 100);
  await bus.publish({ id: "live", namespace: "agent-a", content: "persistent context", payload: { value: 2 } }, 100);
  const result = await bus.query("agent-a", "context", 10, 111);
  assert.deepEqual(result.map((item) => item.id), ["live"]);
});
