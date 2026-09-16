import assert from "node:assert/strict";
import test from "node:test";
import { GoalDecomposerError } from "../../src/types/goal-decomposition.types.js";
import { GoalDecompositionEngine } from "../../src/planner/goal-decomposition-engine.js";

const engine = new GoalDecompositionEngine();

const invariantHolds = (nodes: readonly { id: string; dependencies: readonly string[] }[]): boolean => {
  const position = new Map(nodes.map((node, index) => [node.id, index]));
  return nodes.every((node) => node.dependencies.every((dependency) => {
    const dependencyPosition = position.get(dependency);
    const nodePosition = position.get(node.id);
    return dependencyPosition !== undefined && nodePosition !== undefined && dependencyPosition < nodePosition;
  }));
};

test("decomposes a single high-level goal into one task", () => {
  const result = engine.decompose({ goal: "Build the authentication service" });
  assert.equal(result.normalizedGoal, "Build the authentication service");
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0]?.id, "goal-task-001");
  assert.deepEqual(result.nodes[0]?.dependencies, []);
  assert.equal(result.planRequest.nodes.length, 1);
});

test("extracts ordered dependencies from explicit numbered steps", () => {
  const result = engine.decompose({
    goal: "1. Design the API 2. Implement the API 3. Add tests",
    agentType: "builder",
  });
  assert.deepEqual(result.nodes.map((node) => node.id), ["goal-task-001", "goal-task-002", "goal-task-003"]);
  assert.deepEqual(result.nodes.map((node) => node.dependencies), [[], ["goal-task-001"], ["goal-task-002"]]);
  assert.ok(invariantHolds(result.nodes));
  assert.equal(result.nodes.every((node) => node.agentType === "builder"), true);
});

test("extracts ordered dependencies from then clauses", () => {
  const result = engine.decompose({ goal: "Design the schema, then implement the service, followed by integration tests" });
  assert.deepEqual(result.nodes.map((node) => node.description), [
    "Design the schema,",
    "implement the service,",
    "integration tests",
  ]);
  assert.ok(invariantHolds(result.nodes));
});

test("normalizes whitespace and preserves deterministic task identity", () => {
  const first = engine.decompose({ goal: "  Build   API\n then   write   tests.  " });
  const second = engine.decompose({ goal: "Build API then write tests." });
  assert.equal(first.normalizedGoal, "Build API then write tests.");
  assert.deepEqual(first.nodes, second.nodes);
  assert.deepEqual(first.planRequest.edges, [
    { from: "goal-task-001", to: "goal-task-002" },
  ]);
});

test("rejects empty goals", () => {
  assert.throws(
    () => engine.decompose({ goal: "   " }),
    (error: unknown) => error instanceof GoalDecomposerError && error.code === "GOAL_EMPTY",
  );
});

test("rejects oversized goals", () => {
  assert.throws(
    () => engine.decompose({ goal: "x".repeat(10_001) }),
    (error: unknown) => error instanceof GoalDecomposerError && error.code === "GOAL_TOO_LONG",
  );
});

test("rejects oversized task fragments", () => {
  const longTask = "x".repeat(2_001);
  assert.throws(
    () => engine.decompose({ goal: `1. ${longTask}` }),
    (error: unknown) => error instanceof GoalDecomposerError && error.code === "GOAL_TASK_TOO_LONG",
  );
});

test("rejects non-string goals at runtime", () => {
  assert.throws(
    () => engine.decompose({ goal: 42 as unknown as string }),
    (error: unknown) => error instanceof GoalDecomposerError && error.code === "GOAL_INVALID_TYPE",
  );
});

test("propagates constraints and metadata without changing graph order", () => {
  const result = engine.decompose({
    goal: "Implement the endpoint; verify the endpoint",
    constraints: [{ type: "scope", value: "backend", description: "Backend only" }],
    metadata: { phase: "9.2" },
  });
  assert.deepEqual(result.planRequest.constraints, [{ type: "scope", value: "backend", description: "Backend only" }]);
  assert.deepEqual(result.nodes[0]?.constraints, result.planRequest.constraints);
  assert.deepEqual(result.nodes[0]?.metadata, { phase: "9.2" });
  assert.ok(invariantHolds(result.nodes));
});

test("produces a deterministic topological order for disconnected task syntax", () => {
  const result = engine.decompose({ goal: "Prepare the runtime; prepare the tests" });
  assert.deepEqual(result.nodes.map((node) => node.id), ["goal-task-001", "goal-task-002"]);
  for (const node of result.nodes.slice(1)) {
    const dependency = node.dependencies[0];
    assert.ok(dependency !== undefined);
    assert.equal(result.nodes.findIndex((candidate) => candidate.id === dependency) < result.nodes.findIndex((candidate) => candidate.id === node.id), true);
  }
});


test("returns a valid TaskGraphPlanRequest shape for Phase 9.1", () => {
  const result = engine.decompose({ goal: "Create the planner then test the planner" });
  assert.equal(result.planRequest.goal, result.normalizedGoal);
  assert.equal(result.planRequest.nodes, result.nodes);
  assert.equal(result.planRequest.edges?.length, 1);
  assert.deepEqual(result.planRequest.edges?.[0], { from: "goal-task-001", to: "goal-task-002" });
});
