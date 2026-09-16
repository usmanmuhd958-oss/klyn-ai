import assert from "node:assert/strict";
import test from "node:test";
import { canonicalize } from "../src/Canonicalizer.js";
import { IntentCompiler } from "../src/IntentCompiler.js";
import { IntentTransitionError } from "../src/IntentErrors.js";
import { IntentStateMachine } from "../src/IntentStateMachine.js";
import type { IntentContent, IntentSpec } from "../src/IntentSpec.js";
import { verifyIntentContentHash } from "../src/IntentSpec.js";

function validInput(): IntentContent {
  return {
    specVersion: "1.0.0",
    objective: {
      statement: "Implement a deterministic backend capability",
      outcome: "A verified backend capability exists without UI changes",
      scope: ["packages/cognitive-engine", "packages/execution-runtime"],
    },
    constraints: [
      { id: "no-ui", kind: "PROHIBITION", statement: "Do not modify frontend code" },
      { id: "typed", kind: "INVARIANT", statement: "No implicit any types" },
    ],
    assumptions: [{ id: "node", statement: "Node.js 22 or newer is available" }],
    dependencies: [
      { id: "crypto", kind: "RESOURCE", name: "Node crypto", required: true, dependsOn: [] },
      { id: "core", kind: "PACKAGE", name: "@klyn/core-runtime", version: "1.0.0", required: true, dependsOn: ["crypto"] },
    ],
    acceptanceCriteria: [
      { id: "deterministic", description: "Same content produces the same canonical hash", verification: "PROOF", required: true },
      { id: "tests", description: "Unit tests pass", verification: "TEST", required: true },
    ],
    riskPolicy: {
      maxRiskLevel: "MEDIUM",
      allowedActions: ["read", "write-workspace"],
      requireHumanApproval: false,
      autoPromotion: false,
    },
    requiredEvidence: [
      { id: "hash", kind: "ARTIFACT_HASH", description: "Content hash recorded", required: true },
      { id: "tests", kind: "TEST_RESULT", description: "Test output recorded", required: true },
    ],
    resourceBudget: {
      maxCpuMillis: 10_000,
      maxMemoryBytes: 64 * 1024 * 1024,
      maxWallClockMillis: 30_000,
      maxConcurrentTasks: 4,
      maxNetworkRequests: 50,
      maxArtifactBytes: 10 * 1024 * 1024,
    },
  };
}

test("canonicalization is invariant to object property order and unordered declarative lists", () => {
  const compiler = new IntentCompiler();
  const first = compiler.compile(validInput());
  const second = compiler.compile({
    ...validInput(),
    constraints: [...validInput().constraints].reverse(),
    assumptions: [...validInput().assumptions].reverse(),
    dependencies: [...validInput().dependencies].reverse(),
    acceptanceCriteria: [...validInput().acceptanceCriteria].reverse(),
    requiredEvidence: [...validInput().requiredEvidence].reverse(),
    objective: { ...validInput().objective, scope: [...validInput().objective.scope].reverse() },
  });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  if (!first.accepted || !second.accepted) return;
  assert.equal(first.spec.canonicalContent, second.spec.canonicalContent);
  assert.equal(first.spec.contentHash, second.spec.contentHash);
  assert.equal(first.spec.intentId, second.spec.intentId);
  assert.match(first.spec.intentId, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(verifyIntentContentHash(first.spec), true);
});

test("compiler produces a deeply immutable FROZEN specification", () => {
  const result = new IntentCompiler().compile(validInput());
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.spec.state, "FROZEN");
  assert.equal(Object.isFrozen(result.spec), true);
  assert.equal(Object.isFrozen(result.spec.objective), true);
  assert.equal(Object.isFrozen(result.spec.constraints), true);
  assert.equal(Object.isFrozen(result.spec.resourceBudget), true);
  assert.throws(() => {
    (result.spec as unknown as { state: "EXECUTABLE" }).state = "EXECUTABLE";
  }, TypeError);
  assert.throws(() => {
    (result.spec.objective.scope as string[]).push("mutation");
  }, TypeError);
});

test("state machine enforces the lifecycle and rejects invalid transitions", () => {
  const compiler = new IntentCompiler();
  const compiled = compiler.compile(validInput());
  assert.equal(compiled.accepted, true);
  if (!compiled.accepted) return;

  const machine = new IntentStateMachine();
  const draft: IntentSpec = { ...compiled.spec, state: "DRAFT" };
  const validating = machine.transition(draft, "VALIDATING");
  const validated = machine.transition(validating, "VALIDATED");
  const frozen = machine.transition(validated, "FROZEN");
  const executable = machine.transition(frozen, "EXECUTABLE");

  assert.equal(validating.state, "VALIDATING");
  assert.equal(validated.state, "VALIDATED");
  assert.equal(frozen.state, "FROZEN");
  assert.equal(executable.state, "EXECUTABLE");
  assert.throws(() => machine.transition(executable, "DRAFT"), IntentTransitionError);
  assert.throws(() => machine.transition(frozen, "VALIDATED"), IntentTransitionError);
});

test("malformed payloads are rejected with typed structural issues", () => {
  const result = new IntentCompiler().compile({ objective: "not-an-object" });
  assert.equal(result.accepted, false);
  if (result.accepted) return;
  assert.equal(result.rejection.state, "REJECTED");
  assert.ok(result.rejection.issues.some((issue) => issue.path === "objective"));
  assert.ok(result.rejection.issues.some((issue) => issue.path === "specVersion"));
});

test("cyclic and unknown dependency graphs are rejected before execution planning", () => {
  const base = validInput();
  const cyclic: IntentContent = {
    ...base,
    dependencies: [
      { ...base.dependencies[0], dependsOn: ["core"] },
      { ...base.dependencies[1], dependsOn: ["crypto"] },
    ],
  };
  const cycleResult = new IntentCompiler().compile(cyclic);
  assert.equal(cycleResult.accepted, false);
  if (!cycleResult.accepted) assert.ok(cycleResult.rejection.issues.some((issue) => issue.code === "CYCLIC_DEPENDENCY"));

  const unknown: IntentContent = {
    ...base,
    dependencies: [
      base.dependencies[0],
      { ...base.dependencies[1], dependsOn: ["missing"] },
    ],
  };
  const unknownResult = new IntentCompiler().compile(unknown);
  assert.equal(unknownResult.accepted, false);
  if (!unknownResult.accepted) assert.ok(unknownResult.rejection.issues.some((issue) => issue.code === "UNKNOWN_DEPENDENCY"));
});

test("resource budgets above compiler policy are rejected", () => {
  const compiler = new IntentCompiler({
    maxCpuMillis: 1000,
    maxMemoryBytes: 1024,
    maxWallClockMillis: 1000,
    maxConcurrentTasks: 2,
    maxNetworkRequests: 2,
    maxArtifactBytes: 1024,
  });
  const result = compiler.compile(validInput());
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.rejection.issues.filter((issue) => issue.code === "BUDGET_EXCEEDED").length, 6);
});

test("distinct content fixtures do not share SHA-256 content hashes", () => {
  const compiler = new IntentCompiler();
  const hashes = new Set<string>();
  for (let index = 0; index < 256; index += 1) {
    const input: IntentContent = {
      ...validInput(),
      objective: { ...validInput().objective, statement: `Implement a deterministic backend capability ${index}` },
    };
    const result = compiler.compile(input);
    assert.equal(result.accepted, true);
    if (result.accepted) hashes.add(result.spec.contentHash);
  }
  assert.equal(hashes.size, 256);
});

test("canonicalizer rejects unsupported non-finite JSON numbers", () => {
  assert.throws(() => canonicalize({ value: Number.NaN }), TypeError);
  assert.throws(() => canonicalize({ value: Number.POSITIVE_INFINITY }), TypeError);
});
