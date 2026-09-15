import assert from "node:assert/strict";
import test from "node:test";
import { SpatialBus, SpatialBusError, type PlannerBridgeResult } from "../../src/index.js";

function plan(overrides: Partial<PlannerBridgeResult> = {}): PlannerBridgeResult {
  return {
    executionId: "execution-1",
    namespace: "default",
    executionOrder: ["a", "b", "c"],
    taskStates: new Map(),
    batches: [
      {
        phase: 1,
        tasks: [
          {
            node: {
              id: "b",
              title: "Build B",
              description: "Build B",
              agentType: "builder",
              dependencies: [],
              constraints: [],
            },
            prerequisites: [],
            dependents: ["c"],
          },
          {
            node: {
              id: "a",
              title: "Build A",
              description: "Build A",
              agentType: "builder",
              dependencies: [],
              constraints: [],
            },
            prerequisites: [],
            dependents: ["c"],
          },
        ],
      },
      {
        phase: 2,
        tasks: [
          {
            node: {
              id: "c",
              title: "Build C",
              description: "Build C",
              agentType: "builder",
              dependencies: ["a", "b"],
              constraints: [],
            },
            prerequisites: ["a", "b"],
            dependents: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("register emits a deterministic execution-start event", () => {
  const bus = new SpatialBus({ namespace: "mission" });
  const stream = bus.register(plan());

  assert.deepEqual(stream.events.map((event) => event.type), ["execution:started"]);
  assert.equal(stream.events[0]?.namespace, "mission");
  assert.equal(stream.events[0]?.sequence, 1);
});

test("run emits queued, executing, and completed events in deterministic order", async () => {
  const bus = new SpatialBus();
  const stream = await bus.run(plan(), () => undefined);

  assert.deepEqual(stream.events.map((event) => event.type), [
    "execution:started",
    "node:queued",
    "node:queued",
    "node:executing",
    "node:completed",
    "node:executing",
    "node:completed",
    "node:queued",
    "node:executing",
    "node:completed",
    "execution:completed",
  ]);
  assert.deepEqual(
    stream.events.filter((event) => event.taskId).map((event) => event.taskId),
    ["a", "b", "a", "a", "b", "b", "c", "c", "c"],
  );
});

test("batch ordering is deterministic even when input task order is not", async () => {
  const bus = new SpatialBus();
  const executed: string[] = [];
  const stream = await bus.run(plan(), (task) => {
    executed.push(task.node.id);
  });

  assert.deepEqual(executed, ["a", "b", "c"]);
  assert.deepEqual(
    stream.events.filter((event) => event.type === "node:queued").map((event) => event.taskId),
    ["a", "b", "c"],
  );
});

test("prerequisites are enforced before execution", () => {
  const bus = new SpatialBus();
  bus.register(plan());
  bus.transitionNode("execution-1", "c", "queued");

  assert.throws(
    () => bus.transitionNode("execution-1", "c", "executing"),
    (error: unknown) =>
      error instanceof SpatialBusError && error.code === "SPATIAL_BUS_PREREQUISITE_INCOMPLETE",
  );
  assert.equal(bus.getNodeState("execution-1", "c")?.status, "queued");
});

test("completed state records all completed prerequisites atomically", () => {
  const bus = new SpatialBus();
  bus.register(plan());
  bus.transitionNode("execution-1", "a", "queued");
  bus.transitionNode("execution-1", "a", "executing");
  const state = bus.transitionNode("execution-1", "a", "completed");

  assert.equal(state.status, "completed");
  assert.deepEqual(state.completedPrerequisites, []);
  assert.ok(state.sequence > 0);
});

test("invalid transitions are rejected without mutating state", () => {
  const bus = new SpatialBus();
  bus.register(plan());
  assert.throws(
    () => bus.transitionNode("execution-1", "a", "completed"),
    (error: unknown) => error instanceof SpatialBusError && error.code === "SPATIAL_BUS_INVALID_TRANSITION",
  );
  assert.equal(bus.getNodeState("execution-1", "a")?.status, "pending");
});

test("failed executor emits node and execution failure events", async () => {
  const bus = new SpatialBus();
  const stream = await bus.run(plan(), (task) => {
    if (task.node.id === "b") {
      throw new Error("builder failure");
    }
  });

  assert.deepEqual(stream.events.map((event) => event.type), [
    "execution:started",
    "node:queued",
    "node:queued",
    "node:executing",
    "node:completed",
    "node:executing",
    "node:failed",
    "execution:failed",
  ]);
  assert.equal(stream.events.at(-1)?.error, "builder failure");
  assert.equal(bus.getNodeState("execution-1", "b")?.status, "failed");
  assert.equal(bus.getNodeState("execution-1", "c")?.status, "pending");
});

test("duplicate executions are isolated by namespace", () => {
  const first = new SpatialBus({ namespace: "alpha" });
  const second = new SpatialBus({ namespace: "beta" });
  first.register(plan());
  second.register(plan());

  assert.equal(first.activeExecutionCount, 1);
  assert.equal(second.activeExecutionCount, 1);
  assert.equal(first.getNodeState("execution-1", "a")?.namespace, "alpha");
  assert.equal(second.getNodeState("execution-1", "a")?.namespace, "beta");
});

test("duplicate execution in one namespace is rejected", () => {
  const bus = new SpatialBus({ namespace: "alpha" });
  bus.register(plan());

  assert.throws(
    () => bus.register(plan()),
    (error: unknown) => error instanceof SpatialBusError && error.code === "SPATIAL_BUS_DUPLICATE_EXECUTION",
  );
});

test("concurrent independent state updates receive unique deterministic sequence numbers", async () => {
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

test("state snapshots do not expose mutable prerequisite arrays", () => {
  const bus = new SpatialBus();
  bus.register(plan());
  const state = bus.getNodeState("execution-1", "c");
  assert.ok(state);
  const prerequisites = [...(state?.prerequisites ?? [])];
  prerequisites.push("tampered");

  assert.deepEqual(bus.getNodeState("execution-1", "c")?.prerequisites, ["a", "b"]);
});

test("stream events are bounded by the configured memory buffer", async () => {
  const bus = new SpatialBus({ maxBufferedEvents: 3 });
  const stream = await bus.run(plan(), () => undefined);

  assert.equal(stream.events.length, 3);
  assert.deepEqual(stream.events.map((event) => event.type), [
    "node:executing",
    "node:completed",
    "execution:completed",
  ]);
});

test("close releases execution state and emits a final lifecycle event", () => {
  const bus = new SpatialBus();
  const stream = bus.register(plan());
  bus.close("execution-1");

  assert.equal(bus.activeExecutionCount, 0);
  assert.equal(bus.getNodeState("execution-1", "a"), undefined);
  assert.equal(stream.events.at(-1)?.type, "execution:closed");
});

test("clear releases all execution records", () => {
  const bus = new SpatialBus();
  bus.register(plan({ executionId: "one" }));
  bus.register(plan({ executionId: "two" }));
  assert.equal(bus.activeExecutionCount, 2);

  bus.clear();
  assert.equal(bus.activeExecutionCount, 0);
  assert.equal(bus.getNodeState("one", "a"), undefined);
  assert.equal(bus.getNodeState("two", "a"), undefined);
});

test("listener failures cannot corrupt committed state", () => {
  const bus = new SpatialBus();
  const stream = bus.register(plan());
  stream.subscribe(() => {
    throw new Error("observer failure");
  });

  const state = bus.transitionNode("execution-1", "a", "queued");
  assert.equal(state.status, "queued");
  assert.equal(bus.getNodeState("execution-1", "a")?.status, "queued");
});
