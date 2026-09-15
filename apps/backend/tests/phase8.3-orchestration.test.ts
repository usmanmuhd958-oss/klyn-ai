import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AgentEventBus, ContextStore, SwarmRouter, type SwarmTask } from "../../../packages/cognitive-engine/src/index.ts";

test("phase 8.3 dispatches concurrent tasks across agents and streams typed events", async () => {
  const bus = new AgentEventBus();
  const contexts = new ContextStore();
  const router = new SwarmRouter(bus, contexts);
  router.registerAgent({ id: "agent-a", capabilities: ["code"] });
  router.registerAgent({ id: "agent-b", capabilities: ["code"] });

  const events: string[] = [];
  const unsubscribe = bus.subscribe("agent.task.*", async (event) => {
    events.push(`${event.topic}:${event.payload.taskId ?? event.payload.agentId}`);
  });

  const tasks: SwarmTask<number>[] = Array.from({ length: 8 }, (_, index) => ({
    id: `task-${index + 1}`,
    requiredCapabilities: ["code"],
    input: index,
  }));
  const started = new Set<string>();

  const results = await router.dispatchParallel(tasks, async (agent, task) => {
    started.add(task.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return `${agent.id}:${task.input}`;
  });

  unsubscribe();
  bus.close();

  assert.equal(results.length, 8);
  assert.equal(started.size, 8);
  assert.deepEqual(new Set(results.map((result) => result.agentId)), new Set(["agent-a", "agent-b"]));
  assert.equal(events.filter((event) => event.startsWith("agent.task.dispatched:")).length, 8);
  assert.equal(events.filter((event) => event.startsWith("agent.task.started:")).length, 8);
  assert.equal(events.filter((event) => event.startsWith("agent.task.completed:")).length, 8);
  assert.equal(results.every((result) => result.state.status === "succeeded"), true);
  assert.equal(results.every((result) => result.context.revision === 1), true);
});

test("phase 8.3 context snapshots are immutable and revisioned", () => {
  const store = new ContextStore<{ status: string; metadata: { count: number } }>();
  const first = store.snapshot("execution-1", { status: "running", metadata: { count: 1 } });
  const second = store.snapshot("execution-1", { status: "succeeded", metadata: { count: 2 } });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(second.parentRevision, 1);
  assert.equal(Object.isFrozen(first.value), true);
  assert.equal(Object.isFrozen(first.value.metadata), true);
  assert.throws(() => {
    (first.value.metadata as { count: number }).count = 99;
  }, TypeError);
  assert.equal(store.history("execution-1").length, 2);
  assert.equal(store.get("execution-1", 1)?.value.metadata.count, 1);
});

test("phase 8.3 rejects duplicate task ownership and unavailable capabilities", async () => {
  const router = new SwarmRouter();
  router.registerAgent({ id: "agent-a", capabilities: ["code"] });
  const task = { id: "duplicate", requiredCapabilities: ["code"], input: null };
  await router.dispatch(task, async () => "ok");
  await assert.rejects(() => router.dispatch(task, async () => "again"), /Duplicate task id/);
  await assert.rejects(
    () => router.dispatch({ id: "no-agent", requiredCapabilities: ["research"], input: null }, async () => "never"),
    /No available agent satisfies capabilities/,
  );
});
