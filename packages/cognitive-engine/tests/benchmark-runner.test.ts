import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BenchmarkRunner,
  ComparativeHarness,
  STANDARD_INTENT_BENCHMARK_SUITE,
  type PromotionSigner,
} from "../src/index.js";

const EXECUTION_TIMESTAMP = 1_800_000_000_000;

const deterministicSigner: PromotionSigner = Object.freeze({
  algorithm: "ed25519",
  sign(payload: Buffer): string {
    return createHash("sha256").update(payload).digest("base64");
  },
  verify(payload: Buffer, signature: string): boolean {
    return createHash("sha256").update(payload).digest("base64") === signature;
  },
});

test("runs all four adversarial scenarios through the five-plane governance path", async () => {
  const runner = new BenchmarkRunner({ signer: deterministicSigner, executionTimestampMs: EXECUTION_TIMESTAMP });
  const artifact = await runner.runSuite(STANDARD_INTENT_BENCHMARK_SUITE);

  assert.deepEqual(
    artifact.executions.map((execution) => [execution.scenarioId, execution.observedKlynOutcome]),
    [
      ["FCR-01", "REJECTED"],
      ["FCR-02", "REJECTED"],
      ["FCR-03", "UNKNOWN"],
      ["FCR-04", "REJECTED"],
    ],
  );

  assert.deepEqual(
    artifact.scenarios.map((scenario) => [scenario.scenarioId, scenario.auditState, scenario.promotionState]),
    [
      ["FCR-01", "REJECTED", "REJECTED_GOVERNANCE"],
      ["FCR-02", "REJECTED", "REJECTED_GOVERNANCE"],
      ["FCR-03", "UNKNOWN", "REJECTED_GOVERNANCE"],
      ["FCR-04", "REJECTED", "REJECTED_GOVERNANCE"],
    ],
  );

  for (const scenario of artifact.scenarios) {
    assert.ok(/^[a-f0-9]{64}$/.test(scenario.observationHash));
    assert.equal(scenario.governanceResult.audit.intentId, scenario.intentId);
    assert.equal(scenario.governanceResult.promotion.state, "REJECTED_GOVERNANCE");
  }
});

test("preserves the scientific separation between naive success claims and KLYN epistemic outcomes", async () => {
  const harness = new ComparativeHarness({ signer: deterministicSigner, executionTimestampMs: EXECUTION_TIMESTAMP });
  const report = await harness.run(STANDARD_INTENT_BENCHMARK_SUITE);

  assert.equal(report.standardLlmSystemMetrics.nominalExecutionPasses, 3);
  assert.equal(report.standardLlmSystemMetrics.falseCompletions, 3);
  assert.equal(report.standardLlmSystemMetrics.falseCompletionRate, 1);

  assert.equal(report.klynSystemMetrics.nominalExecutionPasses, 3);
  assert.equal(report.klynSystemMetrics.falseCompletions, 0);
  assert.equal(report.klynSystemMetrics.falseCompletionRate, 0);
  assert.equal(report.lowerFalseCompletionRateObserved, true);
  assert.equal(report.oracleOutcomeAccuracy, 1);
});

test("emits a cryptographically verifiable immutable benchmark artifact", async () => {
  const runner = new BenchmarkRunner({ signer: deterministicSigner, executionTimestampMs: EXECUTION_TIMESTAMP });
  const first = await runner.runSuite(STANDARD_INTENT_BENCHMARK_SUITE);
  const second = await runner.runSuite(STANDARD_INTENT_BENCHMARK_SUITE);

  assert.equal(first.resultManifest.manifestHash, second.resultManifest.manifestHash);
  assert.equal(first.runHash, second.runHash);
  assert.equal(BenchmarkRunner.verifyArtifact(first), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.resultManifest), true);
  assert.equal(Object.isFrozen(first.scenarios), true);

  const tampered = { ...first, runHash: "0".repeat(64) };
  assert.equal(BenchmarkRunner.verifyArtifact(tampered), false);
});

test("fixture observations reach Plane 4 rather than being replaced by a success signal", async () => {
  const runner = new BenchmarkRunner({ signer: deterministicSigner, executionTimestampMs: EXECUTION_TIMESTAMP });
  const artifact = await runner.runSuite(STANDARD_INTENT_BENCHMARK_SUITE);
  const counts = artifact.scenarios.map((scenario) => [scenario.scenarioId, scenario.observations.length]);

  assert.deepEqual(counts, [
    ["FCR-01", 2],
    ["FCR-02", 2],
    ["FCR-03", 1],
    ["FCR-04", 2],
  ]);
});
