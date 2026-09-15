import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DistributedEventBridge,
  InMemoryDurableEventTransport,
  type DistributedEvent,
  type DurableEventTransport,
  type EventDelivery,
} from "../../../packages/ai-engine/src/index.ts";
import { AgentEventBus, type SwarmEventEnvelope } from "../../../packages/cognitive-engine/src/index.ts";
import { ClusterStateRehydrator } from "../src/distributed-state.ts";
import { NodeHeartbeatMonitor } from "../src/node-heartbeat-monitor.ts";

class ReorderingTransport implements DurableEventTransport {
  private readonly handlers = new Map<string, (delivery: EventDelivery) => Promise<void>>();
  readonly published: DistributedEvent[] = [];

  async publish<T>(event: DistributedEvent<T>): Promise<void> { this.published.push(event); }
  subscribe<T>(_topic: string, consumerId: string, handler: (delivery: EventDelivery<T>) => Promise<void>): () => void {
    this.handlers.set(consumerId, handler as (delivery: EventDelivery) => Promise<void>);
    return () => this.handlers.delete(consumerId);
  }
  async deliver(consumerId: string, event: DistributedEvent, attempt = 1): Promise<void> {
    await this.handlers.get(consumerId)?.({ deliveryId: `${event.id}:${attempt}`, event, attempt });
  }
}

test("phase 8.7 publishes AgentEventBus events through a durable transport and suppresses duplicate delivery", async () => {
  const bus = new AgentEventBus();
  const transport = new InMemoryDurableEventTransport();
  const bridge = new DistributedEventBridge(bus, { nodeId: "node-a", transport, consumerId: "node-b" });
  const received: SwarmEventEnvelope[] = [];
  bus.subscribe("agent.task.completed", async (event) => { received.push(event); });
  bridge.bridgeLocalPublish("agent.task.completed");
  bridge.bridgeTopic("agent.task.completed");

  await bus.publish("agent.task.completed", { taskId: "t1", agentId: "a1", output: "ok" });
  assert.equal(transport.history().length, 1);
  assert.equal(received.length, 1);

  const event = transport.history()[0];
  await transport.publish(event);
  assert.equal(received.length, 1);
  bridge.close();
});

test("phase 8.7 preserves per-node sequence metadata while accepting cross-node reordering", async () => {
  const bus = new AgentEventBus();
  const transport = new ReorderingTransport();
  const bridge = new DistributedEventBridge(bus, { nodeId: "node-a", transport, consumerId: "node-b" });
  const topics: string[] = [];
  bus.subscribe("agent.task.*", async (event) => { topics.push(event.topic); });
  bridge.bridgeTopic("agent.task.*");

  const first = await bridge.publish("agent.task.started", { taskId: "t1", agentId: "a1" });
  const second = await bridge.publish("agent.task.completed", { taskId: "t1", agentId: "a1", output: "ok" });
  await transport.deliver("node-b", second);
  await transport.deliver("node-b", first);
  assert.deepEqual(topics, ["agent.task.completed", "agent.task.started"]);
  assert.equal(first.sequence + 1, second.sequence);
  bridge.close();
});

test("phase 8.7 rehydrates the newest contiguous revision after node failure", () => {
  const history = [
    { executionId: "exec-1", revision: 1, timestamp: 1, nodeId: "node-a", value: { step: "build" } },
    { executionId: "exec-1", revision: 2, timestamp: 2, nodeId: "node-a", value: { step: "test" } },
    { executionId: "exec-1", revision: 3, timestamp: 3, nodeId: "node-b", value: { step: "deploy" } },
  ];
  const rehydrator = new ClusterStateRehydrator({ history: () => [history[2], history[0], history[1]] });
  const state = rehydrator.rehydrate("exec-1");
  assert.equal(state?.revision, 3);
  assert.equal(state?.sourceNodeId, "node-b");
  assert.deepEqual(state?.value, { step: "deploy" });
});

test("phase 8.7 rejects a broken revision chain instead of silently restoring partial state", () => {
  const rehydrator = new ClusterStateRehydrator({ history: () => [
    { executionId: "exec-2", revision: 1, timestamp: 1, nodeId: "node-a", value: { step: "one" } },
    { executionId: "exec-2", revision: 3, timestamp: 3, nodeId: "node-b", value: { step: "three" } },
  ] });
  assert.throws(() => rehydrator.rehydrate("exec-2"), /Non-contiguous context history/);
});

test("phase 8.7 evicts silent nodes and reassigns each orphan task once", async () => {
  let now = 1_000;
  const reassigned: string[] = [];
  const monitor = new NodeHeartbeatMonitor({ reassign: async (taskId: string) => { reassigned.push(taskId); } }, { nodeTimeoutMs: 100, evictionGraceMs: 50, now: () => now });
  monitor.join("node-a");
  now += 151;
  assert.deepEqual(monitor.observe([{ taskId: "t1", nodeId: "node-a" }]), ["node-a"]);
  assert.equal(monitor.getNode("node-a")?.status, "evicted");
  await monitor.reassignOrphans([{ taskId: "t1", nodeId: "node-a" }, { taskId: "t2", nodeId: "node-a" }]);
  await monitor.reassignOrphans([{ taskId: "t1", nodeId: "node-a" }]);
  assert.deepEqual(reassigned, ["t1", "t2"]);
});
