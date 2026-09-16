import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProductionPromotionSignoffEngine,
  ProductionPromotionSignoffError,
} from "../src/production-promotion-signoff.js";

const engine = new ProductionPromotionSignoffEngine();
const validInput = {
  decision: "APPROVED" as const,
  intentId: "intent-phase-7c",
  targetCommit: "7e595eda138b1a0cd58a751b3e8ce55f8b4876b0",
  auditChainHash: "a".repeat(64),
  evidenceHash: "b".repeat(64),
  testSummary: {
    cognitiveEngine: { passed: 82 as const, total: 82 as const },
    executionRuntime: { passed: 25 as const, total: 25 as const },
    agentCore: { passed: 10 as const, total: 10 as const },
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
  assert.equal(first.artifactVersion, "7C-1.0.0");
  assert.equal(first.identifier, "KLYN-CORE-1.0-RELEASE-FINAL");
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
        cognitiveEngine: { passed: 81, total: 82 },
        executionRuntime: { passed: 25, total: 25 },
        agentCore: { passed: 10, total: 10 },
      },
    }),
    (error: unknown) => error instanceof ProductionPromotionSignoffError && /exactly 82\/82/.test(error.message),
  );
});
