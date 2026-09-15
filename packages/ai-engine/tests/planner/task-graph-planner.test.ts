import assert from "node:assert/strict";
import test from "node:test";
import { TaskGraphPlanner } from "../../src/planner/task-graph-planner.js";
import { TaskGraphNode, TaskGraphPlannerError } from "../../src/types/task-graph.types.js";

const node = (id: string, dependencies: readonly string[] = []): TaskGraphNode => ({
  id,
  title: id,
  description: `Task ${id}`,
  agentType: "builder",
  dependencies,
  constraints: [],
});

const planner = new TaskGraphPlanner();

const expectError = (code: TaskGraphPlannerError["code"], nodes: readonly TaskGraphNode[], edges = []): void => {
  assert.throws(() => planner.plan({ goal: "test", nodes, edges }), (error: unknown) => {
    assert.ok(error instanceof TaskGraphPlannerError);
    assert.equal(error.code, code);
    return true;
  });
};

test("single node produces a valid plan", () => {
  const plan = planner.plan({ goal: "single", nodes: [node("A")] });
  assert.deepEqual(plan.executionOrder, ["A"]);
  assert.deepEqual(plan.dependencyMap.prerequisites.get("A"), []);
  assert.deepEqual(plan.dependencyMap.dependents.get("A"), []);
});

test("linear DAG is topologically ordered", () => {
  const plan = planner.plan({ goal: "linear", nodes: [node("A"), node("B", ["A"]), node("C", ["B"]) ] });
  assert.deepEqual(plan.executionOrder, ["A", "B", "C"]);
});

test("parallel DAG preserves dependencies and deterministic ordering", () => {
  const plan = planner.plan({ goal: "parallel", nodes: [node("C", ["A", "B"]), node("B"), node("A")] });
  assert.deepEqual(plan.executionOrder, ["A", "B", "C"]);
  assert.deepEqual(plan.dependencyMap.prerequisites.get("C"), ["A", "B"]);
  assert.deepEqual(plan.dependencyMap.dependents.get("A"), ["C"]);
  assert.deepEqual(plan.dependencyMap.dependents.get("B"), ["C"]);
});

test("independent nodes are deterministically ordered", () => {
  const first = planner.plan({ goal: "independent", nodes: [node("Z"), node("A"), node("M")] });
  const second = planner.plan({ goal: "independent", nodes: [node("M"), node("Z"), node("A")] });
  assert.deepEqual(first.executionOrder, ["A", "M", "Z"]);
  assert.deepEqual(second.executionOrder, first.executionOrder);
});

test("empty graph is rejected", () => {
  expectError("TASK_GRAPH_EMPTY", []);
});

test("duplicate node ID is rejected", () => {
  expectError("TASK_GRAPH_DUPLICATE_NODE", [node("A"), node("A")]);
});

test("missing dependency node is rejected", () => {
  expectError("TASK_GRAPH_MISSING_NODE", [node("A", ["UNKNOWN"]) ]);
});

test("missing explicit edge source is rejected", () => {
  expectError("TASK_GRAPH_MISSING_NODE", [node("A")], [{ from: "UNKNOWN", to: "A" }]);
});

test("missing explicit edge target is rejected", () => {
  expectError("TASK_GRAPH_MISSING_NODE", [node("A")], [{ from: "A", to: "UNKNOWN" }]);
});

test("self dependency is rejected", () => {
  expectError("TASK_GRAPH_SELF_CYCLE", [node("A", ["A"]) ]);
});

test("two-node cycle is rejected", () => {
  expectError("TASK_GRAPH_CYCLE", [node("A", ["B"]), node("B", ["A"]) ]);
});

test("multi-node cycle is rejected", () => {
  expectError("TASK_GRAPH_CYCLE", [node("A", ["C"]), node("B", ["A"]), node("C", ["B"]) ]);
});

test("explicit self edge is rejected", () => {
  expectError("TASK_GRAPH_SELF_CYCLE", [node("A")], [{ from: "A", to: "A" }]);
});

test("disconnected components are valid", () => {
  const plan = planner.plan({ goal: "disconnected", nodes: [node("B", ["A"]), node("A"), node("D", ["C"]), node("C")] });
  assert.deepEqual(plan.executionOrder, ["A", "B", "C", "D"]);
});

test("duplicate dependency declarations are normalized to one edge", () => {
  const plan = planner.plan({ goal: "duplicates", nodes: [node("A"), node("B", ["A", "A"]) ] });
  assert.deepEqual(plan.edges, [{ from: "A", to: "B" }]);
  assert.deepEqual(plan.executionOrder, ["A", "B"]);
});

test("explicit edges and node dependencies are merged without duplicate edges", () => {
  const plan = planner.plan({ goal: "merge", nodes: [node("A"), node("B", ["A"])], edges: [{ from: "A", to: "B" }] });
  assert.deepEqual(plan.edges, [{ from: "A", to: "B" }]);
});

test("all topological invariants hold for a valid graph", () => {
  const plan = planner.plan({ goal: "invariants", nodes: [node("D", ["B", "C"]), node("C", ["A"]), node("B", ["A"]), node("A")] });
  const position = new Map(plan.executionOrder.map((id, index) => [id, index]));
  assert.equal(position.size, plan.nodes.length);
  for (const edge of plan.edges) {
    assert.ok(position.get(edge.from)! < position.get(edge.to)!);
  }
});

test("planner output is immutable at the top-level collections", () => {
  const plan = planner.plan({ goal: "immutable", nodes: [node("A")] });
  assert.throws(() => {
    (plan.executionOrder as string[]).push("B");
  }, TypeError);
});
