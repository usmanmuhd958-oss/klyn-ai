import assert from "node:assert/strict";
import test from "node:test";
import { ImmutableTaskStateStore, SpatialBus, SpatialBusError, type PlannerBridgeResult } from "../../src/index.js";

function plan(overrides: Partial<PlannerBridgeResult> = {}): PlannerBridgeResult {
  return {
    executionId: "execution-1",
    namespace: "default",
    executionOrder: ["a", "b", "c"],
    taskStates: new ImmutableTaskStateStore([]),
    batches: [
      {
        phase: 1,
        tasks: [
          { node: { id: "b", title: "Build B", description: "Build B", agentType: "builder", dependencies: [], constraints: [] }, prerequisites: [], dependents: ["c"] },
          { node: { id: "a", title: "Build A", description: "Build A", agentType: "builder", dependencies: [], constraints: [] }, prerequisites: [], dependents: ["c"] },
        ],
      },
      {
        phase: 2,
        tasks: [
          { node: { id: "c", title: "Build C", description: "Build C", agentType: "builder", dependencies: ["a", "b"], constraints: [] }, prerequisites: ["a", "b"], dependents: [] },
        ],
      },
    ],
    ...overrides,
  };
}

test("run is deterministic and uses canonical lifecycle events", async () => {
  const stream = await new SpatialBus().run(plan(), () => undefined);
  assert.deepEqual(stream.events.map((event) => event.type), [
    "execution:started", "node:queued", "node:queued", "node:executing", "node:completed",
    "node:executing", "node:completed", "node:queued", "node:executing", "node:completed", "execution:completed",
  ]);
});

test("invalid transitions are rejected without state mutation", () => {
  const bus = new SpatialBus();
  bus.register(plan());
  assert.throws(() => bus.transitionNode("execution-1", "a", "completed"), (error: unknown) => error instanceof SpatialBusError && error.code === "SPATIAL_BUS_INVALID_TRANSITION");
  assert.equal(bus.getNodeState("execution-1", "a")?.status, "pending");
});

test("concurrent independent transitions preserve unique state snapshots", async () => {
  const bus = new SpatialBus();
  bus.register(plan());
  bus.transitionNode("execution-1", "a", "queued");
  bus.transitionNode("execution-1", "b", "queued");
  await Promise.all([
    Promise.resolve().then(() => bus.transitionNode("execution-1", "a", "executing")),
    Promise.resolve().then(() => bus.transitionNode("execution-1", "b", "executing")),
  ]);
  const states = bus.getExecutionStates("execution-1");
  assert.equal(new Set(states.map((state) => state.sequence)).size, states.length);
  assert.equal(states.filter((state) => state.status === "executing").length, 2);
});

test("event buffer is bounded and copy-on-read", async () => {
  const stream = await new SpatialBus({ maxBufferedEvents: 3 }).run(plan(), () => undefined);
  assert.equal(stream.events.length, 3);
  const events = [...stream.events];
  events.pop();
  assert.equal(stream.events.length, 3);
});

test("close clears listeners and buffered events", () => {
  const bus = new SpatialBus();
  const stream = bus.register(plan());
  let notifications = 0;
  stream.subscribe(() => { notifications += 1; });
  bus.close("execution-1");
  assert.equal(bus.activeExecutionCount, 0);
  assert.equal(stream.events.length, 0);
  assert.equal(notifications, 1);
});

test("clear releases every execution and stream buffer", () => {
  const bus = new SpatialBus();
  const first = bus.register(plan({ executionId: "one" }));
  const second = bus.register(plan({ executionId: "two" }));
  bus.clear();
  assert.equal(bus.activeExecutionCount, 0);
  assert.equal(first.events.length, 0);
  assert.equal(second.events.length, 0);
});
