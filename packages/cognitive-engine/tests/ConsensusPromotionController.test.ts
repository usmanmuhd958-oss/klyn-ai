import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConsensusPromotionController,
  PHASE_7A_CERTIFIED_SUBSTRATES,
  PHASE_7A_EXPECTED_TESTS,
  type PromotionAuditRecord,
} from "../src/ConsensusPromotionController.js";

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as Record<string, unknown>;
  return Object.keys(object).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = canonicalize(object[key]);
    return result;
  }, {});
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function makeAuditTrail(intentId: string, count = 3): PromotionAuditRecord[] {
  const records: PromotionAuditRecord[] = [];
  for (let index = 1; index <= count; index += 1) {
    const unsigned = {
      sequence: index,
      callId: `call-${index}`,
      agentId: `agent-${index}`,
      intentId,
      tool: "ast-patch" as const,
      requestHash: hash({ callId: `call-${index}` }),
      resultHash: hash({ result: index }),
      previousAuditHash: records.at(-1)?.auditHash ?? null,
    };
    records.push(Object.freeze({ ...unsigned, auditHash: hash(unsigned) }));
  }
  return records;
}

const validEvidence = [
  { suite: "cognitive-engine" as const, passed: PHASE_7A_EXPECTED_TESTS["cognitive-engine"], total: 82, failed: 0, skipped: 0 },
  { suite: "execution-runtime" as const, passed: PHASE_7A_EXPECTED_TESTS["execution-runtime"], total: 25, failed: 0, skipped: 0 },
  { suite: "agent-core" as const, passed: PHASE_7A_EXPECTED_TESTS["agent-core"], total: 10, failed: 0, skipped: 0 },
];

const validInput = {
  intentId: "intent-phase-7c",
  auditTrail: makeAuditTrail("intent-phase-7c"),
  testEvidence: validEvidence,
  selfHealing: {
    attempts: 1,
    maxAttempts: 3,
    recovered: true,
    exhausted: false,
    unhandledErrors: 0,
  },
  noFrontendChanges: true,
  coreInvariantsUnmodified: true,
  certifiedSubstrates: PHASE_7A_CERTIFIED_SUBSTRATES,
};

const targetCommit = "7e595eda138b1a0cd58a751b3e8ce55f8b4876b0";

void test("approves a complete cryptographically continuous promotion evidence set", () => {
  const decision = new ConsensusPromotionController().evaluate(validInput, targetCommit);
  assert.equal(decision.state, "APPROVED");
  assert.equal(decision.reasons.length, 0);
  assert.equal(decision.auditChain.valid, true);
  assert.equal(decision.auditChain.terminalAuditHash?.length, 64);
  assert.equal(decision.evidenceHash.length, 64);
  assert.equal(decision.decisionHash.length, 64);
});

void test("rejects a tampered audit record even when test evidence is perfect", () => {
  const tampered = [...validInput.auditTrail];
  tampered[1] = Object.freeze({ ...tampered[1], resultHash: hash("tampered") });
  const decision = new ConsensusPromotionController().evaluate({ ...validInput, auditTrail: tampered }, targetCommit);
  assert.equal(decision.state, "REJECTED");
  assert.match(decision.reasons.join(" | "), /Audit hash mismatch/);
});

void test("rejects unresolved self-healing errors and incomplete suite evidence", () => {
  const decision = new ConsensusPromotionController().evaluate({
    ...validInput,
    testEvidence: validEvidence.map((evidence) => evidence.suite === "agent-core" ? { ...evidence, passed: 9 } : evidence),
    selfHealing: { attempts: 3, maxAttempts: 3, recovered: false, exhausted: true, unhandledErrors: 1 },
  }, targetCommit);
  assert.equal(decision.state, "REJECTED");
  assert.match(decision.reasons.join(" | "), /agent-core test evidence/);
  assert.match(decision.reasons.join(" | "), /Self-healing recovery/);
  assert.match(decision.reasons.join(" | "), /Unhandled self-healing errors/);
});
