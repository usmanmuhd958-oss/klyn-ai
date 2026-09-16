import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProductionPromotionSignoffEngine,
  ProductionPromotionSignoffError,
} from "../src/production-promotion-signoff.js";

const engine = new ProductionPromotionSignoffEngine();
const validInput = {
  decision: "APPROVED" as const,
  intentId: "intent-phase-7a",
  targetCommit: "7e595eda138b1a0cd58a751b3e8ce55f8b4876b0",
  auditChainHash: "a".repeat(64),
  evidenceHash: "b".repeat(64),
  testSummary: {
    cognitiveEngine: { passed: 79 as const, total: 79 as const },
    executionRuntime: { passed: 25 as const, total: 25 as const },
    agentCore: { passed: 7 as const, total: 7 as const },
  },
  unhandledErrors: 0,
  certifiedSubstrates: [
    "fb9f11eb8882f6d427855f54ed56d0ed793722fd",
    "7e30523f20d20d99070c50ad75dc5893fd1cabf1",
    "7e595eda138b1a0cd58a751b3e8ce55f8b4876b0",
  ] as const,
};

void test("creates and verifies a deterministic production sign-off artifact", () => {
  const first = engine.create(validInput);
  const second = engine.create(validInput);
  assert.deepEqual(first, second);
  assert.equal(first.artifactVersion, "7A-1.0.0");
  assert.equal(first.policyId, "KLYN-CORE-1.0-PROMOTION-V1");
  assert.equal(ProductionPromotionSignoffEngine.verify(first), true);
});

void test("rejects any unresolved production error", () => {
  assert.throws(
    () => engine.create({ ...validInput, unhandledErrors: 1 }),
    (error: unknown) => error instanceof ProductionPromotionSignoffError && /Unhandled self-healing/.test(error.message),
  );
});

void test("rejects non-approved decisions and incomplete test evidence", () => {
  assert.throws(
    () => engine.create({ ...validInput, decision: "REJECTED" }),
    (error: unknown) => error instanceof ProductionPromotionSignoffError && /only be issued for APPROVED/.test(error.message),
  );
  assert.throws(
    () => engine.create({
      ...validInput,
      testSummary: {
        cognitiveEngine: { passed: 78, total: 79 },
        executionRuntime: { passed: 25, total: 25 },
        agentCore: { passed: 7, total: 7 },
      },
    }),
    (error: unknown) => error instanceof ProductionPromotionSignoffError && /exactly 79\/79/.test(error.message),
  );
});
