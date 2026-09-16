import { createHash } from "node:crypto";
import {
  BenchmarkRunner,
  type BenchmarkRunArtifact,
  type BenchmarkRunnerOptions,
} from "./BenchmarkRunner.js";
import {
  EpistemicMetricEvaluator,
  type BenchmarkResultManifest,
  type StandardLlmBaselineEvaluation,
} from "./EpistemicMetricEvaluator.js";
import {
  STANDARD_INTENT_BENCHMARK_SUITE,
  type IntentBenchmarkSuite,
} from "./benchmark/IntentBenchmarkSuite.js";

export interface SystemFalseCompletionMetrics {
  readonly totalScenarios: number;
  readonly nominalExecutionPasses: number;
  readonly falseCompletions: number;
  readonly falseCompletionRate: number;
}

export interface ComparativeBenchmarkReport {
  readonly reportVersion: "1.0.0";
  readonly suiteHash: string;
  readonly executionTimestampMs: number;
  readonly standardLlmBaseline: StandardLlmBaselineEvaluation;
  readonly standardLlmSystemMetrics: SystemFalseCompletionMetrics;
  readonly klynResultManifest: BenchmarkResultManifest;
  readonly klynSystemMetrics: SystemFalseCompletionMetrics;
  readonly lowerFalseCompletionRateObserved: boolean;
  readonly oracleOutcomeAccuracy: number;
  readonly benchmarkRun: BenchmarkRunArtifact;
  readonly reportHash: string;
}

export interface ComparativeHarnessOptions extends BenchmarkRunnerOptions {
  readonly evaluator?: EpistemicMetricEvaluator;
  readonly runner?: BenchmarkRunner;
}

export class ComparativeHarnessError extends Error {
  readonly code = "COMPARATIVE_HARNESS_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "ComparativeHarnessError";
  }
}

const EMPTY_TIMESTAMP = 1_800_000_000_000;

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
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function calculateSystemFalseCompletionMetrics(
  executions: readonly { readonly scenarioId: string; readonly claimedOutcome: "UNKNOWN" | "VERIFIED" | "REJECTED" }[],
  suite: IntentBenchmarkSuite,
): SystemFalseCompletionMetrics {
  const scenarios = new Map(suite.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  let nominalExecutionPasses = 0;
  let falseCompletions = 0;

  for (const execution of executions) {
    const scenario = scenarios.get(execution.scenarioId);
    if (!scenario) throw new ComparativeHarnessError(`Unknown comparative scenario: ${execution.scenarioId}`);
    if (scenario.oracle.standardExecutionSignal === "PASS") {
      nominalExecutionPasses += 1;
      if (scenario.oracle.expectedKlynOutcome !== "VERIFIED" && execution.claimedOutcome === "VERIFIED") {
        falseCompletions += 1;
      }
    }
  }

  return Object.freeze({
    totalScenarios: executions.length,
    nominalExecutionPasses,
    falseCompletions,
    falseCompletionRate: safeRatio(falseCompletions, nominalExecutionPasses),
  });
}

export class ComparativeHarness {
  private readonly evaluator: EpistemicMetricEvaluator;

  constructor(private readonly options: ComparativeHarnessOptions) {
    this.evaluator = options.evaluator ?? new EpistemicMetricEvaluator();
  }

  async run(suite: IntentBenchmarkSuite = STANDARD_INTENT_BENCHMARK_SUITE): Promise<ComparativeBenchmarkReport> {
    const timestamp = this.options.executionTimestampMs ?? EMPTY_TIMESTAMP;
    const runner = this.options.runner ?? new BenchmarkRunner({
      signer: this.options.signer,
      risk: this.options.risk,
      promotionTarget: this.options.promotionTarget,
      executionTimestampMs: timestamp,
      orchestrator: this.options.orchestrator,
      metricEvaluator: this.evaluator,
    });
    const benchmarkRun = await runner.runSuite(suite);
    if (!BenchmarkRunner.verifyArtifact(benchmarkRun, this.evaluator)) {
      throw new ComparativeHarnessError("Benchmark run artifact failed cryptographic verification");
    }

    const standardLlmBaseline = benchmarkRun.resultManifest.standardLlmBaseline;
    const standardLlmSystemMetrics = this.calculateBaselineSystemMetrics(standardLlmBaseline, suite);
    const klynSystemMetrics = calculateSystemFalseCompletionMetrics(
      benchmarkRun.executions.map((execution) => ({
        scenarioId: execution.scenarioId,
        claimedOutcome: execution.observedKlynOutcome,
      })),
      suite,
    );
    const oracleOutcomeAccuracy = this.calculateOracleOutcomeAccuracy(benchmarkRun, suite);

    const reportBody = {
      reportVersion: "1.0.0" as const,
      suiteHash: suite.suiteHash,
      executionTimestampMs: timestamp,
      standardLlmBaseline,
      standardLlmSystemMetrics,
      klynResultManifest: benchmarkRun.resultManifest,
      klynSystemMetrics,
      lowerFalseCompletionRateObserved: klynSystemMetrics.falseCompletionRate < standardLlmSystemMetrics.falseCompletionRate,
      oracleOutcomeAccuracy,
      benchmarkRun,
    };

    return Object.freeze({ ...reportBody, reportHash: digest(reportBody) });
  }

  private calculateBaselineSystemMetrics(
    baseline: StandardLlmBaselineEvaluation,
    suite: IntentBenchmarkSuite,
  ): SystemFalseCompletionMetrics {
    const executions = baseline.results.map((result) => ({
      scenarioId: result.scenarioId,
      claimedOutcome: result.claimedExecutionSignal === "PASS" ? "VERIFIED" as const : "UNKNOWN" as const,
    }));
    return calculateSystemFalseCompletionMetrics(executions, suite);
  }

  private calculateOracleOutcomeAccuracy(benchmarkRun: BenchmarkRunArtifact, suite: IntentBenchmarkSuite): number {
    const scenarios = new Map(suite.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
    let matched = 0;
    for (const execution of benchmarkRun.executions) {
      const scenario = scenarios.get(execution.scenarioId);
      if (!scenario) throw new ComparativeHarnessError(`Unknown oracle scenario: ${execution.scenarioId}`);
      if (execution.observedKlynOutcome === scenario.oracle.expectedKlynOutcome) matched += 1;
    }
    return safeRatio(matched, suite.scenarios.length);
  }

  static verifyReport(report: ComparativeBenchmarkReport): boolean {
    const { reportHash, ...body } = report;
    return reportHash === digest(body) && BenchmarkRunner.verifyArtifact(report.benchmarkRun);
  }
}
