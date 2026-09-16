import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  ClaimsVerifier,
  Ed25519PromotionSigner,
  EpistemicAuditEngine,
  EvidenceGraphBuilder,
  GovernanceOrchestrator,
  GovernancePolicyEngine,
  IntentCompiler,
  IntentStateMachine,
  PromotionController,
  type EvidenceObservation,
  type GovernanceRiskInput,
  type IntentContent,
  type IntentGraphTask,
  type IntentSpec,
} from "../src/index.js";

const ZERO_HASH = "0".repeat(64);
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }

function content(risk: IntentContent["riskPolicy"]["maxRiskLevel"] = "LOW"): IntentContent {
  return {
    specVersion: "1.0.0",
    objective: { statement: "Complete verified task", outcome: "Verified capability exists", scope: ["backend"] },
    constraints: [{ id: "backend-only", kind: "PROHIBITION", statement: "No frontend changes" }],
    assumptions: [{ id: "node", statement: "Node.js >= 22" }],
    dependencies: [],
    acceptanceCriteria: [{ id: "accept-1", description: "Runtime assertion passes", verification: "TEST", required: true }],
    riskPolicy: { maxRiskLevel: risk, allowedActions: ["read", "write"], requireHumanApproval: false, autoPromotion: true },
    requiredEvidence: [{ id: "evidence-1", kind: "OBSERVATION", description: "Required runtime evidence", required: true }],
    resourceBudget: { maxCpuMillis: 5_000, maxMemoryBytes: 64 * 1024 * 1024, maxWallClockMillis: 5_000, maxConcurrentTasks: 2, maxNetworkRequests: 0, maxArtifactBytes: 64 * 1024 },
  };
}

function frozenIntent(risk: IntentContent["riskPolicy"]["maxRiskLevel"] = "LOW"): IntentSpec {
  const result = new IntentCompiler().compile(content(risk));
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error("fixture compilation failed");
  const stateMachine = new IntentStateMachine();
  const validating = stateMachine.transition({ ...result.spec, state: "DRAFT" }, "VALIDATING");
  const validated = stateMachine.transition(validating, "VALIDATED");
  return stateMachine.transition(validated, "FROZEN");
}

function signer(): Ed25519PromotionSigner {
  const keys = generateKeyPairSync("ed25519");
  return new Ed25519PromotionSigner(keys.privateKey, keys.publicKey);
}

function auditRecord(intent: IntentSpec, state: "VERIFIED" | "EVIDENCE-SUPPORTED"): ReturnType<EpistemicAuditEngine["finalize"]> {
  const observation: EvidenceObservation = {
    executionId: "execution:test",
    sequence: 0,
    timestampMs: 1_700_000_000_000,
    type: "runtime.assertion",
    payload: { criterionId: "accept-1", passed: true, evidenceId: "evidence-1" },
    hash: hash({ observation: "test" }),
    previousHash: ZERO_HASH,
  };
  const graph = new EvidenceGraphBuilder().build(intent, [observation]);
  const verification = new ClaimsVerifier().verify(intent, graph);
  const engine = new EpistemicAuditEngine("execution:test", intent.intentId);
  engine.claim();
  engine.observe();
  if (state === "VERIFIED") return engine.prove(graph, verification);
  engine.support("partial evidence only");
  return engine.finalize(graph.graphHash, verification.verificationHash);
}

const noRisk: GovernanceRiskInput = { securityPosture: "NONE", destructiveOperationalScope: "NONE", dependencyBoundary: "NONE", breakingApiSurface: "NONE" };

test("autonomously promotes a fully verified low-risk intent", () => {
  const intent = frozenIntent();
  const audit = auditRecord(intent, "VERIFIED");
  const governance = new GovernancePolicyEngine().evaluate(intent, audit, noRisk);
  const controller = new PromotionController();
  controller.beginPrePromotionAudit();
  const signing = signer();
  const decision = controller.promote(intent, audit, governance, "SANDBOX_STAGING", signing, 1_700_000_000_000);
  assert.equal(decision.state, "PROMOTED");
  assert.ok(decision.manifest);
  assert.equal(PromotionController.verifyManifest(decision.manifest, signing), true);
});

test("rejects promotion when audit is evidence-supported but not verified", () => {
  const intent = frozenIntent();
  const audit = auditRecord(intent, "EVIDENCE-SUPPORTED");
  const governance = new GovernancePolicyEngine().evaluate(intent, audit, noRisk);
  const controller = new PromotionController();
  controller.beginPrePromotionAudit();
  const decision = controller.promote(intent, audit, governance, "SANDBOX_STAGING", signer(), 1);
  assert.equal(decision.state, "REJECTED_GOVERNANCE");
  assert.match(decision.reason ?? "", /VERIFIED/);
});

test("rejects governance when a critical risk vector is present", () => {
  const intent = frozenIntent();
  const audit = auditRecord(intent, "VERIFIED");
  const governance = new GovernancePolicyEngine().evaluate(intent, audit, { ...noRisk, securityPosture: "CRITICAL" });
  assert.equal(governance.promotable, false);
  assert.equal(governance.criticalViolationCount, 1);
});

test("requires consensus for high-risk intents", () => {
  const intent = frozenIntent("HIGH");
  const audit = auditRecord(intent, "VERIFIED");
  const governance = new GovernancePolicyEngine().evaluate(intent, audit, noRisk);
  assert.equal(governance.consensusRequired, true);
  assert.equal(governance.consensusSatisfied, false);
  assert.equal(governance.promotable, false);
});

test("executes the full five-plane path and produces a signed promotion manifest", async () => {
  const intent = frozenIntent();
  const runtime = {
    execute: async (task: IntentGraphTask): Promise<{ observations: readonly EvidenceObservation[]; value: string; evidenceWeight: number }> => {
      const payload = task.kind === "ACCEPTANCE_CHECK" ? { criterionId: task.sourceId, passed: true } : task.kind === "EVIDENCE_CHECK" ? { evidenceId: task.sourceId, passed: true } : { taskId: task.id };
      const observation: EvidenceObservation = { executionId: `execution:${task.id}`, sequence: 0, timestampMs: 1_700_000_000_000, type: task.kind === "ACCEPTANCE_CHECK" || task.kind === "EVIDENCE_CHECK" ? "runtime.assertion" : "process.started", payload, hash: hash({ task: task.id, payload }), previousHash: ZERO_HASH };
      return { observations: [observation], value: task.id, evidenceWeight: 1 };
    },
  };
  const signing = signer();
  const result = await new GovernanceOrchestrator().executeIntentToVerifiedReality(intent, { runtime, risk: noRisk, promotionTarget: "SANDBOX_STAGING", signer: signing, createdAt: 1_700_000_000_000 });
  assert.equal(result.verification.state, "VERIFIED");
  assert.equal(result.audit.state, "VERIFIED");
  assert.equal(result.consensus.disposition, "ACCEPT");
  assert.equal(result.governance.promotable, true);
  assert.equal(result.promotion.state, "PROMOTED");
  assert.ok(result.promotion.manifest);
  assert.equal(PromotionController.verifyManifest(result.promotion.manifest, signing), true);
});

test("promotion manifest is tamper-evident and its trace chain is preserved", () => {
  const intent = frozenIntent();
  const audit = auditRecord(intent, "VERIFIED");
  const governance = new GovernancePolicyEngine().evaluate(intent, audit, noRisk);
  const signing = signer();
  const controller = new PromotionController();
  controller.beginPrePromotionAudit();
  const decision = controller.promote(intent, audit, governance, "PROMOTED", signing, 42);
  if (decision.manifest === undefined) throw new Error("manifest missing");
  assert.equal(PromotionController.verifyManifest(decision.manifest, signing), true);
  assert.equal(decision.manifest.traceHashChain.length, audit.transitions.length);
  const tampered = { ...decision.manifest, target: "tampered" };
  assert.equal(PromotionController.verifyManifest(tampered, signing), false);
});
