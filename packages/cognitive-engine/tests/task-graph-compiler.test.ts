import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionPlanner,
  IntentCompiler,
  IntentStateMachine,
  TaskGraphCompiler,
  WorldModelBuilder,
  type IntentContent,
  type IntentSpec,
} from "../src/index.js";

function content(): IntentContent {
  return {
    specVersion: "1.0.0",
    objective: {
      statement: "Build a verified backend capability",
      outcome: "Capability exists and is independently verifiable",
      scope: ["packages/cognitive-engine"],
    },
    constraints: [
      { id: "typed", kind: "INVARIANT", statement: "strict TypeScript" },
      { id: "backend", kind: "PROHIBITION", statement: "no frontend changes" },
    ],
    assumptions: [{ id: "node", statement: "Node.js >= 22 is available" }],
    dependencies: [
      { id: "runtime", kind: "PACKAGE", name: "runtime", required: true, dependsOn: [] },
      { id: "crypto", kind: "RESOURCE", name: "node:crypto", required: true, dependsOn: ["runtime"] },
    ],
    acceptanceCriteria: [
      { id: "compile", description: "compiler produces a deterministic graph", verification: "PROOF", required: true },
      { id: "tests", description: "tests pass", verification: "TEST", required: true },
    ],
    riskPolicy: {
      maxRiskLevel: "LOW",
      allowedActions: ["read", "write"],
      requireHumanApproval: false,
      autoPromotion: false,
    },
    requiredEvidence: [
      { id: "hash", kind: "ARTIFACT_HASH", description: "hash is recorded", required: true },
      { id: "tests", kind: "TEST_RESULT", description: "test result is recorded", required: true },
    ],
    resourceBudget: {
      maxCpuMillis: 10000,
      maxMemoryBytes: 1024 * 1024 * 1024,
      maxWallClockMillis: 30000,
      maxConcurrentTasks: 4,
      maxNetworkRequests: 10,
      maxArtifactBytes: 10 * 1024 * 1024,
    },
  };
}

function freezeIntent(result: Extract<ReturnType<IntentCompiler["compile"]>, { accepted: true }>): IntentSpec {
  const machine = new IntentStateMachine();
  const validating = machine.transition({ ...result.spec, state: "DRAFT" }, "VALIDATING");
  const validated = machine.transition(validating, "VALIDATED");
  return machine.transition(validated, "FROZEN");
}

function executableIntent(): IntentSpec {
  const result = new IntentCompiler().compile(content());
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error("fixture failed to compile");
  return freezeIntent(result);
}

test("world model initializes deterministic epistemic state for a frozen intent", () => {
  const intent = executableIntent();
  const model = new WorldModelBuilder().build(intent);
  assert.equal(model.intentId, intent.intentId);
  assert.equal(model.contentHash, intent.contentHash);
  assert.equal(model.state, "FROZEN");
  const sortedIds = [...model.slots].map((slot) => slot.id).sort();
  assert.deepEqual(model.slots.map((slot) => slot.id), sortedIds);
  assert.equal(model.slots.find((slot) => slot.id === "objective")?.status, "OBSERVED");
  assert.equal(model.slots.find((slot) => slot.id === "assumption:node")?.status, "ASSUMED");
  assert.equal(model.slots.find((slot) => slot.id === "evidence:hash")?.status, "UNKNOWN");
  assert.equal(model.resources.allocatedCpuMillis, 0);
  assert.equal(model.resources.allocatedConcurrentTasks, 0);
  assert.throws(() => new WorldModelBuilder().build({ ...intent, state: "DRAFT" }), /FROZEN or EXECUTABLE/);
});

test("world model accepts EXECUTABLE state and rejects tampered cryptographic identity", () => {
  const intent = executableIntent();
  const executable = new IntentStateMachine().transition(intent, "EXECUTABLE");
  assert.equal(new WorldModelBuilder().build(executable).state, "EXECUTABLE");
  assert.throws(() => new WorldModelBuilder().build({ ...intent, contentHash: "0".repeat(64) }), /content hash|identity/);
});

test("identical intent content compiles into an identical task graph", () => {
  const intent = executableIntent();
  const equivalentContent: IntentContent = {
    ...content(),
    constraints: [...content().constraints].reverse(),
    dependencies: [...content().dependencies].reverse(),
    acceptanceCriteria: [...content().acceptanceCriteria].reverse(),
    requiredEvidence: [...content().requiredEvidence].reverse(),
  };
  const equivalent = new IntentCompiler().compile(equivalentContent);
  assert.equal(equivalent.accepted, true);
  if (!equivalent.accepted) return;
  const secondFrozen = freezeIntent(equivalent);
  const compiler = new TaskGraphCompiler();
  const first = compiler.compile(intent);
  const second = compiler.compile(secondFrozen);
  assert.deepEqual(first.tasks, second.tasks);
  assert.deepEqual(first.resolution.order, second.resolution.order);
  assert.deepEqual(first.resolution.layers, second.resolution.layers);
  assert.equal(first.contentHash, second.contentHash);
});

test("dependency tasks precede the objective and downstream verification tasks", () => {
  const graph = new TaskGraphCompiler().compile(executableIntent());
  const position = new Map(graph.resolution.order.map((id, index) => [id, index]));
  assert.ok((position.get("dependency:runtime") ?? -1) < (position.get(`objective:${graph.intentId}`) ?? -1));
  assert.ok((position.get("dependency:crypto") ?? -1) < (position.get(`objective:${graph.intentId}`) ?? -1));
  assert.ok((position.get(`objective:${graph.intentId}`) ?? -1) < (position.get("acceptance:compile") ?? -1));
  assert.ok((position.get(`objective:${graph.intentId}`) ?? -1) < (position.get("evidence:hash") ?? -1));
});

test("dependency mismatch is rejected before graph resolution", () => {
  const intent = executableIntent();
  const broken: IntentSpec = {
    ...intent,
    dependencies: intent.dependencies.map((dependency) => dependency.id === "crypto" ? { ...dependency, dependsOn: ["missing"] } : dependency),
  };
  assert.throws(() => new TaskGraphCompiler().compile(broken), /missing node|Unknown dependency/);
});

test("compiler rejects a cyclic dependency graph", () => {
  const base = content();
  const cyclic: IntentContent = {
    ...base,
    dependencies: [
      { id: "runtime", kind: "PACKAGE", name: "runtime", required: true, dependsOn: ["crypto"] },
      { id: "crypto", kind: "RESOURCE", name: "node:crypto", required: true, dependsOn: ["runtime"] },
    ],
  };
  const result = new IntentCompiler().compile(cyclic);
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.ok(result.rejection.issues.some((issue) => issue.code === "CYCLIC_DEPENDENCY"));
});

test("execution planner is deterministic and respects the intent concurrency budget", () => {
  const intent = executableIntent();
  const graph = new TaskGraphCompiler().compile(intent);
  const planner = new ExecutionPlanner();
  const first = planner.plan(intent, graph);
  const second = planner.plan(intent, graph);
  assert.deepEqual(first, second);
  assert.ok(first.maxConcurrency <= intent.resourceBudget.maxConcurrentTasks);
  assert.ok(first.maxConcurrency >= 1);
  assert.equal(first.layerConcurrency.length, graph.resolution.layers.length);
  for (const concurrency of first.layerConcurrency) assert.ok(concurrency <= first.maxConcurrency);
});

test("planner rejects an intent/graph identity mismatch", () => {
  const intent = executableIntent();
  const graph = new TaskGraphCompiler().compile(intent);
  assert.throws(() => new ExecutionPlanner().plan({ ...intent, contentHash: "0".repeat(64) }, graph), /identity mismatch/);
});
