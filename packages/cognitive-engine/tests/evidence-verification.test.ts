import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ClaimsVerifier,
  EvidenceGraphBuilder,
  EpistemicAuditEngine,
  IntentCompiler,
  IntentStateMachine,
  type EvidenceObservation,
  type IntentContent,
  type IntentSpec,
} from "../src/index.js";

function content(): IntentContent {
  return {
    specVersion: "1.0.0",
    objective: { statement: "Build a verified capability", outcome: "Capability satisfies the intent", scope: ["packages/cognitive-engine"] },
    constraints: [{ id: "backend", kind: "PROHIBITION", statement: "No frontend changes" }],
    assumptions: [{ id: "node", statement: "Node.js >= 22" }],
    dependencies: [{ id: "runtime", kind: "PACKAGE", name: "execution-runtime", required: true, dependsOn: [] }],
    acceptanceCriteria: [{ id: "tests", description: "Runtime tests pass", verification: "TEST", required: true }],
    riskPolicy: { maxRiskLevel: "LOW", allowedActions: ["read", "write"], requireHumanApproval: false, autoPromotion: false },
    requiredEvidence: [{ id: "assertion", kind: "OBSERVATION", description: "Runtime assertion exists", required: true }],
    resourceBudget: { maxCpuMillis: 5000, maxMemoryBytes: 64 * 1024 * 1024, maxWallClockMillis: 5000, maxConcurrentTasks: 2, maxNetworkRequests: 0, maxArtifactBytes: 64 * 1024 },
  };
}

function frozenIntent(): IntentSpec {
  const result = new IntentCompiler().compile(content());
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error("fixture compilation failed");
  const machine = new IntentStateMachine();
  const validating = machine.transition({ ...result.spec, state: "DRAFT" }, "VALIDATING");
  return machine.transition(machine.transition(validating, "VALIDATED"), "FROZEN");
}

function observation(input: Omit<EvidenceObservation, "hash" | "previousHash">, previousHash = "0".repeat(64)): EvidenceObservation {
  const hash = createHash("sha256").update(JSON.stringify({ ...input, previousHash }), "utf8").digest("hex");
  return Object.freeze({ ...input, hash, previousHash });
}

function matchingObservations(): readonly EvidenceObservation[] {
  const first = observation({ executionId: "exec-1", sequence: 0, timestampMs: 1000, type: "runtime.assertion", payload: { criterionId: "tests", passed: true } });
  const second = observation({ executionId: "exec-1", sequence: 1, timestampMs: 1001, type: "runtime.assertion", payload: { evidenceId: "assertion", passed: true } }, first.hash);
  const third = observation({ executionId: "exec-1", sequence: 2, timestampMs: 1002, type: "process.exited", payload: { criterionId: "tests", exitCode: 0 } }, second.hash);
  return [first, second, third];
}

function verification(observations: readonly EvidenceObservation[]): ReturnType<ClaimsVerifier["verify"]> {
  const intent = frozenIntent();
  const graph = new EvidenceGraphBuilder().build(intent, observations);
  return new ClaimsVerifier().verify(intent, graph);
}

test("verifies required claims when matching runtime assertions and exit evidence exist", () => {
  const intent = frozenIntent();
  const graph = new EvidenceGraphBuilder().build(intent, matchingObservations());
  const result = new ClaimsVerifier().verify(intent, graph);

  assert.equal(result.state, "VERIFIED");
  assert.equal(result.unresolvedClaimIds.length, 0);
  assert.equal(result.rejectedClaimIds.length, 0);
  assert.match(result.verificationHash, /^[a-f0-9]{64}$/);
});

test("rejects deterministically when a runtime assertion contradicts the claim", () => {
  const intent = frozenIntent();
  const positive = observation({ executionId: "exec-2", sequence: 0, timestampMs: 1000, type: "runtime.assertion", payload: { criterionId: "tests", passed: false } });
  const required = observation({ executionId: "exec-2", sequence: 1, timestampMs: 1001, type: "runtime.assertion", payload: { evidenceId: "assertion", passed: true } }, positive.hash);
  const graph = new EvidenceGraphBuilder().build(intent, [positive, required]);
  const result = new ClaimsVerifier().verify(intent, graph);
  assert.equal(result.state, "REJECTED");
  assert.equal(result.rejectedClaimIds.length, 1);
});

test("returns UNKNOWN for an empty observation stream", () => {
  const result = verification([]);
  assert.equal(result.state, "UNKNOWN");
  assert.ok(result.unresolvedClaimIds.length > 0);
});

test("returns UNKNOWN when critical runtime assertion is missing", () => {
  const assertion = observation({ executionId: "exec-3", sequence: 0, timestampMs: 1000, type: "process.started", payload: { command: "node" } });
  const graphIntent = frozenIntent();
  const graph = new EvidenceGraphBuilder().build(graphIntent, [assertion]);
  const result = new ClaimsVerifier().verify(graphIntent, graph);
  assert.equal(result.state, "UNKNOWN");
  assert.ok(result.unresolvedClaimIds.length >= 1);
});

test("contextual evidence cannot promote an acceptance claim to VERIFIED", () => {
  const contextual = observation({ executionId: "exec-4", sequence: 0, timestampMs: 1000, type: "resource.snapshot", payload: { durationMs: 10, memoryLimitBytes: 100 } });
  const intent = frozenIntent();
  const graph = new EvidenceGraphBuilder().build(intent, [contextual]);
  const result = new ClaimsVerifier().verify(intent, graph);
  assert.equal(result.state, "UNKNOWN");
});

test("rejects malformed observation hashes and duplicate observation identities", () => {
  const intent = frozenIntent();
  const malformed: EvidenceObservation = {
    executionId: "exec-5",
    sequence: 0,
    timestampMs: 1,
    type: "stdout",
    payload: {},
    hash: "bad",
    previousHash: "0".repeat(64),
  };
  assert.throws(() => new EvidenceGraphBuilder().build(intent, [malformed]), /Observation hashes must be SHA-256/);

  const valid = observation({ executionId: "exec-5", sequence: 0, timestampMs: 1, type: "stdout", payload: {} });
  assert.throws(() => new EvidenceGraphBuilder().build(intent, [valid, valid]), /Duplicate observation/);
});

test("audit engine records the required epistemic progression and immutable proof", () => {
  const intent = frozenIntent();
  const observations = matchingObservations();
  const graph = new EvidenceGraphBuilder().build(intent, observations);
  const result = new ClaimsVerifier().verify(intent, graph);
  const audit = new EpistemicAuditEngine("exec-1", intent.intentId);
  audit.claim("worker claimed completion");
  audit.observe("observation stream persisted");
  const record = audit.prove(graph, result);

  assert.equal(record.state, "VERIFIED");
  assert.deepEqual(record.transitions.map((item) => item.to), ["CLAIMED", "OBSERVED", "EVIDENCE-SUPPORTED", "VERIFIED"]);
  assert.equal(EpistemicAuditEngine.verifyProof(record), true);
  assert.match(record.proofDigest, /^[a-f0-9]{64}$/);
  assert.notStrictEqual(record.transitions, audit.finalize(graph.graphHash, result.verificationHash).transitions);
});

test("audit proof verification fails after record tampering", () => {
  const intent = frozenIntent();
  const graph = new EvidenceGraphBuilder().build(intent, matchingObservations());
  const result = new ClaimsVerifier().verify(intent, graph);
  const audit = new EpistemicAuditEngine("exec-2", intent.intentId);
  audit.claim();
  audit.observe();
  const record = audit.prove(graph, result);
  const tampered = Object.freeze({ ...record, state: "CLAIMED" as const });
  assert.equal(EpistemicAuditEngine.verifyProof(tampered), false);
});

test("rejected audits are terminal and cannot return to VERIFIED", () => {
  const intent = frozenIntent();
  const audit = new EpistemicAuditEngine("exec-3", intent.intentId);
  audit.claim();
  audit.observe();
  audit.reject("contradicting runtime evidence");
  assert.equal(audit.currentState, "REJECTED");
  assert.throws(() => audit.support(), /Rejected audit is terminal/);
});
