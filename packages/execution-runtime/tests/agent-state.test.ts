import test from "node:test";
import assert from "node:assert/strict";
import { AgentContext, InMemoryAgentEventStore } from "../src/agent-state.js";

test("agent contexts isolate state by execution tree and agent", async () => {
  const store = new InMemoryAgentEventStore();
  const first = new AgentContext("tree-1", "agent-a", store);
  const second = new AgentContext("tree-1", "agent-b", store);
  await first.set("answer", 42);
  await second.set("answer", 7);
  assert.equal((await first.getState()).values.answer, 42);
  assert.equal((await second.getState()).values.answer, 7);
});

test("events receive ordered sequence numbers and streaming hooks", async () => {
  const store = new InMemoryAgentEventStore();
  const seen: string[] = [];
  const context = new AgentContext("tree-2", "agent-a", store, { onToken: async (event) => seen.push(event.payload) });
  await context.emit("started", { ok: true });
  await context.emit("token", "hello");
  const events = await store.read("tree-2", "agent-a");
  assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(seen, ["hello"]);
});
