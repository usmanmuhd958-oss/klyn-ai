import { createHash } from "node:crypto";
import type {
  ExpectedEpistemicOutcome,
  IntentBenchmarkScenario,
  IntentBenchmarkSuite,
} from "./benchmark/IntentBenchmarkSuite.js";

export type EpistemicMetricOutcome = ExpectedEpistemicOutcome;
export type ConfusionMatrixCategory =
  | "TRUE_VERIFIED"
  | "FALSE_COMPLETION"
  | "VALID_REJECTION"
  | "FALSE_REJECTION"
  | "UNRESOLVED_UNKNOWN";

export interface BenchmarkScenarioExecution {
  readonly scenarioId: string;
  readonly observedKlynOutcome: EpistemicMetricOutcome;
}

export interface ScenarioMetricResult {
  readonly scenarioId: string;
  readonly standardExecutionSignal: "PASS" | "FAIL";
  readonly expectedOutcome: ExpectedEpistemicOutcome;
  readonly observedKlynOutcome: EpistemicMetricOutcome;
  readonly classification: ConfusionMatrixCategory;
  readonly previousResultHash: string;
  readonly resultHash: string;
}

export interface ConfusionMatrix {
  readonly TRUE_VERIFIED: number;
  readonly FALSE_COMPLETION: number;
  readonly VALID_REJECTION: number;
  readonly FALSE_REJECTION: number;
  readonly UNRESOLVED_UNKNOWN: number;
}

export interface EpistemicMetrics {
  readonly objectiveVerificationAccuracy: number;
  readonly falseCompletionRate: number;
  readonly totalScenarios: number;
  readonly trueVerifiedOutcomes: number;
  readonly nominalExecutionPasses: number;
  readonly falseCompletions: number;
}

export interface StandardLlmBaselineScenarioResult {
  readonly scenarioId: string;
  readonly claimedExecutionSignal: "PASS" | "FAIL";
  readonly expectedOutcome: ExpectedEpistemicOutcome;
  readonly classification: ConfusionMatrixCategory;
}

export interface StandardLlmBaselineEvaluation {
  readonly evaluatorId: string;
  readonly results: readonly StandardLlmBaselineScenarioResult[];
  readonly nominalExecutionPasses: number;
  readonly falseCompletions: number;
  readonly falseCompletionRate: number;
}

export interface StandardLlmBaselineEvaluator {
  readonly evaluatorId: string;
  evaluateScenario(scenario: IntentBenchmarkScenario): StandardLlmBaselineScenarioResult;
}

export interface BenchmarkResultManifest {
  readonly manifestVersion: "1.0.0";
  readonly suiteHash: string;
  readonly executionTimestampMs: number;
  readonly results: readonly ScenarioMetricResult[];
  readonly confusionMatrix: ConfusionMatrix;
  readonly metrics: EpistemicMetrics;
  readonly standardLlmBaseline: StandardLlmBaselineEvaluation;
  readonly manifestHash: string;
}

export interface BenchmarkMetricEvaluationInput {
  readonly suite: IntentBenchmarkSuite;
  readonly executions: readonly BenchmarkScenarioExecution[];
  readonly executionTimestampMs: number;
  readonly baseline?: StandardLlmBaselineEvaluator;
}

export class EpistemicMetricEvaluatorError extends Error {
  readonly code = "EPISTEMIC_METRIC_EVALUATOR_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "EpistemicMetricEvaluatorError";
  }
}

const EMPTY_HASH = "0".repeat(64);
const CATEGORY_ORDER: readonly ConfusionMatrixCategory[] = Object.freeze([
  "TRUE_VERIFIED",
  "FALSE_COMPLETION",
  "VALID_REJECTION",
  "FALSE_REJECTION",
  "UNRESOLVED_UNKNOWN",
]);

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as Record<string, unknown>;
  return Object.keys(object).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = canonicalize(object[key]);
    return result;
  }, {});
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function classify(
  standardExecutionSignal: "PASS" | "FAIL",
  expectedOutcome: ExpectedEpistemicOutcome,
  observedOutcome: EpistemicMetricOutcome,
): ConfusionMatrixCategory {
  if (expectedOutcome === "VERIFIED" && observedOutcome === "VERIFIED") return "TRUE_VERIFIED";
  if (standardExecutionSignal === "PASS" && (observedOutcome === "REJECTED" || observedOutcome === "UNKNOWN")) return "FALSE_COMPLETION";
  if (expectedOutcome === "REJECTED" && observedOutcome === "REJECTED") return "VALID_REJECTION";
  if (expectedOutcome === "VERIFIED" && observedOutcome === "REJECTED") return "FALSE_REJECTION";
  if (observedOutcome === "UNKNOWN") return "UNRESOLVED_UNKNOWN";
  throw new EpistemicMetricEvaluatorError(
    `Outcome classification is undefined for expected=${expectedOutcome}, observed=${observedOutcome}, signal=${standardExecutionSignal}`,
  );
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

function standardBaselineClassification(
  signal: "PASS" | "FAIL",
  expectedOutcome: ExpectedEpistemicOutcome,
): ConfusionMatrixCategory {
  const observed = signal === "PASS" ? "VERIFIED" : "UNKNOWN";
  return classify(signal, expectedOutcome, observed);
}

export class OracleStandardLlmBaseline implements StandardLlmBaselineEvaluator {
  readonly evaluatorId = "oracle-standard-llm-baseline-v1";

  evaluateScenario(scenario: IntentBenchmarkScenario): StandardLlmBaselineScenarioResult {
    const signal = scenario.oracle.standardExecutionSignal;
    return Object.freeze({
      scenarioId: scenario.scenarioId,
      claimedExecutionSignal: signal,
      expectedOutcome: scenario.oracle.expectedKlynOutcome,
      classification: standardBaselineClassification(signal, scenario.oracle.expectedKlynOutcome),
    });
  }
}

export class EpistemicMetricEvaluator {
  evaluate(input: BenchmarkMetricEvaluationInput): BenchmarkResultManifest {
    this.validateInput(input);

    const scenarioById = new Map(input.suite.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
    const orderedExecutions = [...input.executions].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
    const results: ScenarioMetricResult[] = [];
    let previousResultHash = EMPTY_HASH;

    for (const execution of orderedExecutions) {
      const scenario = scenarioById.get(execution.scenarioId);
      if (!scenario) throw new EpistemicMetricEvaluatorError(`Unknown benchmark scenario: ${execution.scenarioId}`);
      const classification = classify(
        scenario.oracle.standardExecutionSignal,
        scenario.oracle.expectedKlynOutcome,
        execution.observedKlynOutcome,
      );
      const body = {
        scenarioId: scenario.scenarioId,
        standardExecutionSignal: scenario.oracle.standardExecutionSignal,
        expectedOutcome: scenario.oracle.expectedKlynOutcome,
        observedKlynOutcome: execution.observedKlynOutcome,
        classification,
        previousResultHash,
      } as const;
      const result = Object.freeze({ ...body, resultHash: digest(body) });
      results.push(result);
      previousResultHash = result.resultHash;
    }

    const metrics = this.computeMetrics(results);
    const confusionMatrix = this.buildConfusionMatrix(results);
    const baselineEvaluator = input.baseline ?? new OracleStandardLlmBaseline();
    const baselineResults = input.suite.scenarios
      .slice()
      .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))
      .map((scenario) => baselineEvaluator.evaluateScenario(scenario));
    const standardLlmBaseline = this.buildBaselineEvaluation(baselineEvaluator.evaluatorId, baselineResults);

    const manifestBody = {
      manifestVersion: "1.0.0" as const,
      suiteHash: input.suite.suiteHash,
      executionTimestampMs: input.executionTimestampMs,
      results: Object.freeze(results),
      confusionMatrix,
      metrics,
      standardLlmBaseline,
    };

    return deepFreeze({
      ...manifestBody,
      manifestHash: digest(manifestBody),
    });
  }

  verifyManifest(manifest: BenchmarkResultManifest): boolean {
    const { manifestHash, ...body } = manifest;
    if (manifestHash !== digest(body)) return false;

    let previousResultHash = EMPTY_HASH;
    for (const result of manifest.results) {
      const expectedHash = digest({
        scenarioId: result.scenarioId,
        standardExecutionSignal: result.standardExecutionSignal,
        expectedOutcome: result.expectedOutcome,
        observedKlynOutcome: result.observedKlynOutcome,
        classification: result.classification,
        previousResultHash,
      });
      if (result.previousResultHash !== previousResultHash || result.resultHash !== expectedHash) return false;
      previousResultHash = result.resultHash;
    }
    return true;
  }

  buildConfusionMatrix(results: readonly ScenarioMetricResult[]): ConfusionMatrix {
    const counts: Record<ConfusionMatrixCategory, number> = {
      TRUE_VERIFIED: 0,
      FALSE_COMPLETION: 0,
      VALID_REJECTION: 0,
      FALSE_REJECTION: 0,
      UNRESOLVED_UNKNOWN: 0,
    };
    for (const result of results) counts[result.classification] += 1;
    return Object.freeze(
      Object.fromEntries(CATEGORY_ORDER.map((category) => [category, counts[category]])) as ConfusionMatrix,
    );
  }

  private computeMetrics(results: readonly ScenarioMetricResult[]): EpistemicMetrics {
    const totalScenarios = results.length;
    const trueVerifiedOutcomes = results.filter((result) => result.classification === "TRUE_VERIFIED").length;
    const nominalExecutionPasses = results.filter((result) => result.standardExecutionSignal === "PASS").length;
    const falseCompletions = results.filter((result) => result.classification === "FALSE_COMPLETION").length;
    return Object.freeze({
      objectiveVerificationAccuracy: safeRatio(trueVerifiedOutcomes, totalScenarios),
      falseCompletionRate: safeRatio(falseCompletions, nominalExecutionPasses),
      totalScenarios,
      trueVerifiedOutcomes,
      nominalExecutionPasses,
      falseCompletions,
    });
  }

  private buildBaselineEvaluation(
    evaluatorId: string,
    results: readonly StandardLlmBaselineScenarioResult[],
  ): StandardLlmBaselineEvaluation {
    const nominalExecutionPasses = results.filter((result) => result.claimedExecutionSignal === "PASS").length;
    const falseCompletions = results.filter((result) =>
      result.claimedExecutionSignal === "PASS" &&
      result.classification === "FALSE_COMPLETION",
    ).length;
    return Object.freeze({
      evaluatorId,
      results: Object.freeze([...results].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))),
      nominalExecutionPasses,
      falseCompletions,
      falseCompletionRate: safeRatio(falseCompletions, nominalExecutionPasses),
    });
  }

  private validateInput(input: BenchmarkMetricEvaluationInput): void {
    if (!Number.isSafeInteger(input.executionTimestampMs) || input.executionTimestampMs < 0) {
      throw new EpistemicMetricEvaluatorError("executionTimestampMs must be a non-negative safe integer");
    }
    if (input.executions.length !== input.suite.scenarios.length) {
      throw new EpistemicMetricEvaluatorError(
        `Execution count ${input.executions.length} does not match suite count ${input.suite.scenarios.length}`,
      );
    }
    const suiteIds = new Set(input.suite.scenarios.map((scenario) => scenario.scenarioId));
    const executionIds = new Set<string>();
    for (const execution of input.executions) {
      if (executionIds.has(execution.scenarioId)) throw new EpistemicMetricEvaluatorError(`Duplicate execution scenario: ${execution.scenarioId}`);
      executionIds.add(execution.scenarioId);
      if (!suiteIds.has(execution.scenarioId)) throw new EpistemicMetricEvaluatorError(`Unknown execution scenario: ${execution.scenarioId}`);
    }
  }
}
