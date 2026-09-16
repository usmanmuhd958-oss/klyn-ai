import assert from "node:assert/strict";
import test from "node:test";
import {
  EpistemicMetricEvaluator,
  EpistemicMetricEvaluatorError,
  OracleStandardLlmBaseline,
  STANDARD_INTENT_BENCHMARK_SUITE,
  type BenchmarkScenarioExecution,
} from "../src/index.js";

const evaluator = new EpistemicMetricEvaluator();
const timestamp = 1_800_000_000_000;

function execution(scenarioId: string, observedKlynOutcome: "UNKNOWN" | "VERIFIED" | "REJECTED"): BenchmarkScenarioExecution {
  return Object.freeze({ scenarioId, observedKlynOutcome });
}

test("computes OVA and FCR from epistemic outcomes, not nominal process success", () => {
  const suite = STANDARD_INTENT_BENCHMARK_SUITE;
  const manifest = evaluator.evaluate({
    suite,
    executionTimestampMs: timestamp,
    executions: [
      execution("FCR-01", "REJECTED"),
      execution("FCR-02", "REJECTED"),
      execution("FCR-03", "UNKNOWN"),
      execution("FCR-04", "REJECTED"),
    ],
  });

  assert.equal(manifest.metrics.objectiveVerificationAccuracy, 0);
  assert.equal(manifest.metrics.falseCompletionRate, 1);
  assert.equal(manifest.metrics.totalScenarios, 4);
  assert.equal(manifest.metrics.nominalExecutionPasses, 3);
  assert.equal(manifest.metrics.falseCompletions, 3);
});

test("computes a perfect OVA with zero false completion on verified scenarios", () => {
  const suite = STANDARD_INTENT_BENCHMARK_SUITE;
  const customSuite = {
    ...suite,
    scenarios: Object.freeze([
      {
        ...suite.scenarios[0],
        scenarioId: "FCR-10",
        oracle: Object.freeze({
          standardExecutionSignal: "PASS" as const,
          expectedKlynOutcome: "VERIFIED" as const,
          requiredInvariant: "The verified invariant holds",
        }),
      },
    ]),
  };
  const manifest = evaluator.evaluate({
    suite: customSuite,
    executionTimestampMs: timestamp,
    executions: [execution("FCR-10", "VERIFIED")],
  });
  assert.equal(manifest.metrics.objectiveVerificationAccuracy, 1);
  assert.equal(manifest.metrics.falseCompletionRate, 0);
  assert.equal(manifest.confusionMatrix.TRUE_VERIFIED, 1);
});

test("builds the confusion matrix in a deterministic fixed category order", () => {
  const results = [
    execution("FCR-04", "REJECTED"),
    execution("FCR-03", "UNKNOWN"),
    execution("FCR-02", "REJECTED"),
    execution("FCR-01", "REJECTED"),
  ];
  const first = evaluator.evaluate({ suite: STANDARD_INTENT_BENCHMARK_SUITE, executionTimestampMs: timestamp, executions: results });
  const second = evaluator.evaluate({ suite: STANDARD_INTENT_BENCHMARK_SUITE, executionTimestampMs: timestamp, executions: [...results].reverse() });
  assert.deepEqual(first.confusionMatrix, {
    TRUE_VERIFIED: 0,
    FALSE_COMPLETION: 3,
    VALID_REJECTION: 1,
    FALSE_REJECTION: 0,
    UNRESOLVED_UNKNOWN: 0,
  });
  assert.deepEqual(first.confusionMatrix, second.confusionMatrix);
  assert.deepEqual(
    first.results.map((result) => result.scenarioId),
    ["FCR-01", "FCR-02", "FCR-03", "FCR-04"],
  );
});

test("classifies a nominal PASS plus rejected reality as FALSE_COMPLETION", () => {
  const scenario = STANDARD_INTENT_BENCHMARK_SUITE.scenarios[0];
  const manifest = evaluator.evaluate({
    suite: { ...STANDARD_INTENT_BENCHMARK_SUITE, scenarios: Object.freeze([scenario]) },
    executionTimestampMs: timestamp,
    executions: [execution(scenario.scenarioId, "REJECTED")],
  });
  assert.equal(manifest.results[0].classification, "FALSE_COMPLETION");
});

test("classifies expected rejection with rejected reality as VALID_REJECTION", () => {
  const scenario = STANDARD_INTENT_BENCHMARK_SUITE.scenarios[3];
  const manifest = evaluator.evaluate({
    suite: { ...STANDARD_INTENT_BENCHMARK_SUITE, scenarios: Object.freeze([scenario]) },
    executionTimestampMs: timestamp,
    executions: [execution(scenario.scenarioId, "REJECTED")],
  });
  assert.equal(manifest.results[0].classification, "VALID_REJECTION");
});

test("classifies expected verification with rejected reality as FALSE_REJECTION", () => {
  const scenario = {
    ...STANDARD_INTENT_BENCHMARK_SUITE.scenarios[0],
    scenarioId: "FCR-90",
    oracle: Object.freeze({
      standardExecutionSignal: "FAIL" as const,
      expectedKlynOutcome: "VERIFIED" as const,
      requiredInvariant: "The required invariant is verified",
    }),
  };
  const manifest = evaluator.evaluate({
    suite: { ...STANDARD_INTENT_BENCHMARK_SUITE, scenarios: Object.freeze([scenario]) },
    executionTimestampMs: timestamp,
    executions: [execution("FCR-90", "REJECTED")],
  });
  assert.equal(manifest.results[0].classification, "FALSE_REJECTION");
});

test("keeps FAIL plus UNKNOWN as UNRESOLVED_UNKNOWN rather than false completion", () => {
  const scenario = {
    ...STANDARD_INTENT_BENCHMARK_SUITE.scenarios[3],
    scenarioId: "FCR-91",
    oracle: Object.freeze({
      standardExecutionSignal: "FAIL" as const,
      expectedKlynOutcome: "REJECTED" as const,
      requiredInvariant: "The contradiction is rejected",
    }),
  };
  const manifest = evaluator.evaluate({
    suite: { ...STANDARD_INTENT_BENCHMARK_SUITE, scenarios: Object.freeze([scenario]) },
    executionTimestampMs: timestamp,
    executions: [execution("FCR-91", "UNKNOWN")],
  });
  assert.equal(manifest.results[0].classification, "UNRESOLVED_UNKNOWN");
});

test("generates and verifies a deterministic SHA-256 manifest and linked result hashes", () => {
  const input = {
    suite: STANDARD_INTENT_BENCHMARK_SUITE,
    executionTimestampMs: timestamp,
    executions: [
      execution("FCR-01", "REJECTED"),
      execution("FCR-02", "REJECTED"),
      execution("FCR-03", "UNKNOWN"),
      execution("FCR-04", "REJECTED"),
    ],
  } as const;
  const first = evaluator.evaluate(input);
  const second = evaluator.evaluate(input);
  assert.match(first.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.deepEqual(first.results, second.results);
  assert.equal(first.results[0].previousResultHash, "0".repeat(64));
  for (let index = 1; index < first.results.length; index += 1) {
    assert.equal(first.results[index].previousResultHash, first.results[index - 1].resultHash);
  }
  assert.equal(evaluator.verifyManifest(first), true);
});

test("detects tampering in a frozen manifest hash chain", () => {
  const manifest = evaluator.evaluate({
    suite: STANDARD_INTENT_BENCHMARK_SUITE,
    executionTimestampMs: timestamp,
    executions: [
      execution("FCR-01", "REJECTED"),
      execution("FCR-02", "REJECTED"),
      execution("FCR-03", "UNKNOWN"),
      execution("FCR-04", "REJECTED"),
    ],
  });
  const tampered = { ...manifest, results: Object.freeze(manifest.results.map((result, index) => index === 0 ? { ...result, observedKlynOutcome: "VERIFIED" as const } : result)) };
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.results), true);
  assert.equal(evaluator.verifyManifest(tampered), false);
});

test("handles empty metric runs without NaN or division-by-zero results", () => {
  const emptySuite = { suiteVersion: "1.0.0" as const, scenarios: Object.freeze([]), suiteHash: "a".repeat(64) };
  const manifest = evaluator.evaluate({ suite: emptySuite, executions: [], executionTimestampMs: timestamp });
  assert.equal(manifest.metrics.objectiveVerificationAccuracy, 0);
  assert.equal(manifest.metrics.falseCompletionRate, 0);
  assert.ok(Number.isFinite(manifest.metrics.objectiveVerificationAccuracy));
  assert.ok(Number.isFinite(manifest.metrics.falseCompletionRate));
  assert.deepEqual(manifest.confusionMatrix, {
    TRUE_VERIFIED: 0,
    FALSE_COMPLETION: 0,
    VALID_REJECTION: 0,
    FALSE_REJECTION: 0,
    UNRESOLVED_UNKNOWN: 0,
  });
});

test("rejects duplicate, missing, or invalid execution inputs", () => {
  const suite = STANDARD_INTENT_BENCHMARK_SUITE;
  assert.throws(
    () => evaluator.evaluate({ suite, executionTimestampMs: timestamp, executions: [execution("FCR-01", "REJECTED"), execution("FCR-01", "REJECTED")] }),
    (error: unknown) => error instanceof EpistemicMetricEvaluatorError,
  );
  assert.throws(
    () => evaluator.evaluate({ suite, executionTimestampMs: timestamp, executions: [...suite.scenarios.slice(0, 3)].map((item) => execution(item.scenarioId, "REJECTED")) }),
    (error: unknown) => error instanceof EpistemicMetricEvaluatorError && /does not match suite count/.test(error.message),
  );
  assert.throws(
    () => evaluator.evaluate({ suite, executionTimestampMs: timestamp, executions: [...suite.scenarios.map((item) => execution(item.scenarioId, "REJECTED")), execution("FCR-99", "REJECTED")] }),
    (error: unknown) => error instanceof EpistemicMetricEvaluatorError && /does not match suite count/.test(error.message),
  );
  assert.throws(
    () => evaluator.evaluate({ suite, executionTimestampMs: -1, executions: suite.scenarios.map((item) => execution(item.scenarioId, "REJECTED")) }),
    (error: unknown) => error instanceof EpistemicMetricEvaluatorError && /executionTimestampMs/.test(error.message),
  );
});

test("provides a deterministic standard LLM baseline evaluator interface", () => {
  const baseline = new OracleStandardLlmBaseline();
  const results = STANDARD_INTENT_BENCHMARK_SUITE.scenarios.map((scenario) => baseline.evaluateScenario(scenario));
  assert.equal(baseline.evaluatorId, "oracle-standard-llm-baseline-v1");
  assert.equal(results[0].classification, "FALSE_COMPLETION");
  assert.equal(results[2].classification, "FALSE_COMPLETION");
  assert.equal(results[3].classification, "UNRESOLVED_UNKNOWN");
});
