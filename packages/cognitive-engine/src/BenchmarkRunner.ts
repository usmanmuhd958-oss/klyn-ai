import { createHash } from "node:crypto";
import { GovernanceOrchestrator, type GovernanceExecutionAdapter, type GovernanceOrchestratorOptions, type GovernanceExecutionResult } from "./GovernanceOrchestrator.js";
import type { GovernanceRiskInput } from "./GovernancePolicyEngine.js";
import type { PromotionSigner, PromotionState } from "./PromotionController.js";
import type { IntentSpec } from "./IntentSpec.js";
import type { EvidenceObservation } from "./EvidenceGraphBuilder.js";
import {
  STANDARD_INTENT_BENCHMARK_SUITE,
  type CompiledIntentBenchmarkScenario,
  type ExpectedEpistemicOutcome,
  type IntentBenchmarkSuite,
} from "./benchmark/IntentBenchmarkSuite.js";
import {
  EpistemicMetricEvaluator,
  type BenchmarkResultManifest,
  type BenchmarkScenarioExecution,
} from "./EpistemicMetricEvaluator.js";

export interface BenchmarkScenarioRun {
  readonly scenarioId: string;
  readonly intentId: string;
  readonly auditState: GovernanceExecutionResult["audit"]["state"];
  readonly promotionState: PromotionState;
  readonly observedKlynOutcome: ExpectedEpistemicOutcome;
  readonly observations: readonly EvidenceObservation[];
  readonly observationHash: string;
  readonly governanceResult: GovernanceExecutionResult;
}

export interface BenchmarkRunArtifact {
  readonly runVersion: "1.0.0";
  readonly suiteHash: string;
  readonly executionTimestampMs: number;
  readonly scenarios: readonly BenchmarkScenarioRun[];
  readonly executions: readonly BenchmarkScenarioExecution[];
  readonly resultManifest: BenchmarkResultManifest;
  readonly runHash: string;
}

export interface BenchmarkRunnerOptions {
  readonly signer: PromotionSigner;
  readonly risk?: GovernanceRiskInput;
  readonly promotionTarget?: string;
  readonly executionTimestampMs?: number;
  readonly orchestrator?: GovernanceOrchestrator;
  readonly metricEvaluator?: EpistemicMetricEvaluator;
}

export class BenchmarkRunnerError extends Error {
  readonly code = "BENCHMARK_RUNNER_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "BenchmarkRunnerError";
  }
}

const DEFAULT_RISK: GovernanceRiskInput = Object.freeze({
  securityPosture: "NONE",
  destructiveOperationalScope: "NONE",
  dependencyBoundary: "NONE",
  breakingApiSurface: "NONE",
});

const DEFAULT_PROMOTION_TARGET = "benchmark://klyn/adversarial";
const DEFAULT_EXECUTION_TIMESTAMP_MS = 1_800_000_000_000;

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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function freezeObservationSet(observations: readonly EvidenceObservation[]): readonly EvidenceObservation[] {
  return Object.freeze(
    [...observations]
      .sort((a, b) => a.sequence - b.sequence || a.hash.localeCompare(b.hash))
      .map((observation) => Object.freeze({ ...observation })),
  );
}

function deriveOutcome(auditState: GovernanceExecutionResult["audit"]["state"]): ExpectedEpistemicOutcome {
  switch (auditState) {
    case "VERIFIED":
      return "VERIFIED";
    case "REJECTED":
      return "REJECTED";
    case "UNKNOWN":
    case "CLAIMED":
    case "OBSERVED":
    case "EVIDENCE-SUPPORTED":
      return "UNKNOWN";
    default:
      return auditState;
  }
}

type GovernanceTaskExecutionLike = Awaited<ReturnType<GovernanceExecutionAdapter["execute"]>>;

class ScenarioRuntimeAdapter implements GovernanceExecutionAdapter {
  private emitted = false;

  constructor(private readonly observations: readonly EvidenceObservation[]) {}

  async execute(): Promise<GovernanceTaskExecutionLike> {
    if (this.emitted) {
      return Object.freeze({
        observations: Object.freeze([]),
        value: "deterministic benchmark task completed",
        evidenceWeight: 0,
      });
    }
    this.emitted = true;
    return Object.freeze({
      observations: freezeObservationSet(this.observations),
      value: "deterministic benchmark fixture replay completed",
      evidenceWeight: 1,
    });
  }
}

export class BenchmarkRunner {
  constructor(private readonly options: BenchmarkRunnerOptions) {}

  async runSuite(suite: IntentBenchmarkSuite = STANDARD_INTENT_BENCHMARK_SUITE): Promise<BenchmarkRunArtifact> {
    const timestamp = this.options.executionTimestampMs ?? DEFAULT_EXECUTION_TIMESTAMP_MS;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new BenchmarkRunnerError("executionTimestampMs must be a non-negative safe integer");
    }

    const orchestrator = this.options.orchestrator ?? new GovernanceOrchestrator();
    const metricEvaluator = this.options.metricEvaluator ?? new EpistemicMetricEvaluator();
    const scenarios = [...suite.scenarios].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
    const scenarioRuns: BenchmarkScenarioRun[] = [];

    for (const scenario of scenarios) {
      scenarioRuns.push(await this.runScenario(orchestrator, scenario, timestamp));
    }

    const executions = Object.freeze(
      scenarioRuns.map((run) => Object.freeze({
        scenarioId: run.scenarioId,
        observedKlynOutcome: run.observedKlynOutcome,
      })),
    );

    const resultManifest = metricEvaluator.evaluate({
      suite,
      executions,
      executionTimestampMs: timestamp,
    });

    const artifactBody = {
      runVersion: "1.0.0" as const,
      suiteHash: suite.suiteHash,
      executionTimestampMs: timestamp,
      scenarios: Object.freeze(scenarioRuns),
      executions,
      resultManifest,
    };

    return deepFreeze({ ...artifactBody, runHash: digest(artifactBody) });
  }

  private async runScenario(
    orchestrator: GovernanceOrchestrator,
    scenario: CompiledIntentBenchmarkScenario,
    createdAt: number,
  ): Promise<BenchmarkScenarioRun> {
    if (scenario.intent.state !== "FROZEN") {
      throw new BenchmarkRunnerError(
        `Compiled benchmark intent ${scenario.intent.intentId} must be FROZEN before execution`,
      );
    }

    const executableIntent: IntentSpec = scenario.intent;
    const runtime = new ScenarioRuntimeAdapter(scenario.fixtureObservations);
    const governanceOptions: GovernanceOrchestratorOptions = {
      runtime,
      risk: this.options.risk ?? DEFAULT_RISK,
      promotionTarget: this.options.promotionTarget ?? DEFAULT_PROMOTION_TARGET,
      signer: this.options.signer,
      createdAt,
    };
    const governanceResult = await orchestrator.executeIntentToVerifiedReality(executableIntent, governanceOptions);
    const observedKlynOutcome = deriveOutcome(governanceResult.audit.state);
    const observations = freezeObservationSet(governanceResult.observations);
    const observationHash = digest(observations);

    return Object.freeze({
      scenarioId: scenario.scenarioId,
      intentId: executableIntent.intentId,
      auditState: governanceResult.audit.state,
      promotionState: governanceResult.promotion.state,
      observedKlynOutcome,
      observations,
      observationHash,
      governanceResult,
    });
  }

  static verifyArtifact(artifact: BenchmarkRunArtifact, evaluator = new EpistemicMetricEvaluator()): boolean {
    const runBody = {
      runVersion: artifact.runVersion,
      suiteHash: artifact.suiteHash,
      executionTimestampMs: artifact.executionTimestampMs,
      scenarios: artifact.scenarios,
      executions: artifact.executions,
      resultManifest: artifact.resultManifest,
    };
    return artifact.runHash === digest(runBody) && evaluator.verifyManifest(artifact.resultManifest);
  }
}
