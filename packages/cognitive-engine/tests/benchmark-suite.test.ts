import assert from "node:assert/strict";
import test from "node:test";
import {
  IntentBenchmarkSuiteCompiler,
  IntentBenchmarkSuiteError,
  STANDARD_INTENT_BENCHMARK_SUITE,
  type IntentBenchmarkScenario,
} from "../src/index.js";

const expectedKinds = new Map<string, string>([
  ["FCR-01", "SILENT_SIDE_EFFECT_INGESTION"],
  ["FCR-02", "FALSE_PASS_TRAP"],
  ["FCR-03", "PARTIAL_EVIDENCE_FALLACY"],
  ["FCR-04", "CONTRADICTION_BOUNDARY_TEST"],
]);

test("compiles the standard benchmark suite with stable scenario identities", () => {
  const suite = STANDARD_INTENT_BENCHMARK_SUITE;
  assert.equal(suite.suiteVersion, "1.0.0");
  assert.equal(suite.scenarios.length, 4);
  assert.match(suite.suiteHash, /^[a-f0-9]{64}$/);

  for (const scenario of suite.scenarios) {
    assert.equal(expectedKinds.get(scenario.scenarioId), scenario.kind);
    assert.match(scenario.scenarioHash, /^[a-f0-9]{64}$/);
    assert.match(scenario.intent.intentId, /^[0-9a-f]{8}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(scenario.intent.state, "VALIDATED");
    assert.ok(scenario.intent.acceptanceCriteria.length > 0);
    assert.ok(scenario.intent.requiredEvidence.length > 0);
  }
});

test("compilation is deterministic across repeated suite construction", () => {
  const compiler = new IntentBenchmarkSuiteCompiler();
  const first = compiler.compile();
  const second = compiler.compile();
  assert.equal(first.suiteHash, second.suiteHash);
  assert.deepEqual(
    first.scenarios.map((scenario) => [scenario.scenarioId, scenario.scenarioHash, scenario.intent.intentId]),
    second.scenarios.map((scenario) => [scenario.scenarioId, scenario.scenarioHash, scenario.intent.intentId]),
  );
});

test("standard oracle distinguishes nominal execution from epistemic outcome", () => {
  const suite = STANDARD_INTENT_BENCHMARK_SUITE;
  assert.deepEqual(
    suite.scenarios.map((scenario) => [scenario.scenarioId, scenario.oracle.standardExecutionSignal, scenario.oracle.expectedKlynOutcome]),
    [
      ["FCR-01", "PASS", "REJECTED"],
      ["FCR-02", "PASS", "REJECTED"],
      ["FCR-03", "PASS", "UNKNOWN"],
      ["FCR-04", "FAIL", "REJECTED"],
    ],
  );
});

test("rejects duplicate scenario identities before IntentSpec compilation", () => {
  const scenario = STANDARD_INTENT_BENCHMARK_SUITE.scenarios[0];
  const duplicate: IntentBenchmarkScenario = {
    scenarioId: scenario.scenarioId,
    version: scenario.version,
    kind: scenario.kind,
    title: scenario.title,
    description: scenario.description,
    intentContent: scenario.intentContent,
    oracle: scenario.oracle,
    fixtureObservations: scenario.fixtureObservations,
    scenarioHash: scenario.scenarioHash,
  };
  assert.throws(
    () => new IntentBenchmarkSuiteCompiler().compile([scenario, duplicate]),
    (error: unknown) => error instanceof IntentBenchmarkSuiteError && /Duplicate scenario id/.test(error.message),
  );
});

test("rejects empty benchmark suites", () => {
  assert.throws(
    () => new IntentBenchmarkSuiteCompiler().compile([]),
    (error: unknown) => error instanceof IntentBenchmarkSuiteError && /at least one scenario/.test(error.message),
  );
});
