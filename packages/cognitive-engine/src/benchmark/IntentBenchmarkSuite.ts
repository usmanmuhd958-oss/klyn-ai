import { createHash } from "node:crypto";
import { IntentCompiler, type IntentCompilationResult } from "../IntentCompiler.js";
import type { EvidenceObservation } from "../EvidenceGraphBuilder.js";
import type { IntentContent, IntentSpec } from "../IntentSpec.js";

export type BenchmarkScenarioKind = "SILENT_SIDE_EFFECT_INGESTION" | "FALSE_PASS_TRAP" | "PARTIAL_EVIDENCE_FALLACY" | "CONTRADICTION_BOUNDARY_TEST";
export type ExpectedEpistemicOutcome = "UNKNOWN" | "VERIFIED" | "REJECTED";

export interface BenchmarkScenarioOracle {
  readonly standardExecutionSignal: "PASS" | "FAIL";
  readonly expectedKlynOutcome: ExpectedEpistemicOutcome;
  readonly requiredInvariant: string;
}

export interface IntentBenchmarkScenario {
  readonly scenarioId: string;
  readonly version: "1.0.0";
  readonly kind: BenchmarkScenarioKind;
  readonly title: string;
  readonly description: string;
  readonly intentContent: IntentContent;
  readonly oracle: BenchmarkScenarioOracle;
  readonly fixtureObservations: readonly EvidenceObservation[];
  readonly scenarioHash: string;
}

export interface CompiledIntentBenchmarkScenario extends IntentBenchmarkScenario {
  readonly intent: IntentSpec;
}

export interface IntentBenchmarkSuite {
  readonly suiteVersion: "1.0.0";
  readonly scenarios: readonly CompiledIntentBenchmarkScenario[];
  readonly suiteHash: string;
}

export class IntentBenchmarkSuiteError extends Error {
  readonly code = "INTENT_BENCHMARK_SUITE_ERROR" as const;
  constructor(message: string) { super(message); this.name = "IntentBenchmarkSuiteError"; }
}

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

const RISK_POLICY: IntentContent["riskPolicy"] = Object.freeze({
  maxRiskLevel: "LOW",
  allowedActions: Object.freeze(["read", "write"]),
  requireHumanApproval: false,
  autoPromotion: false,
});

function content(
  objective: string,
  acceptance: readonly IntentContent["acceptanceCriteria"][number][],
  evidence: readonly IntentContent["requiredEvidence"][number][],
): IntentContent {
  return {
    specVersion: "1.0.0",
    objective: { statement: objective, outcome: objective, scope: Object.freeze(["benchmark-fixture"]) },
    constraints: Object.freeze([{ id: "backend-only", kind: "PROHIBITION", statement: "No frontend changes" }]),
    assumptions: Object.freeze([{ id: "deterministic-runtime", statement: "Benchmark observations are replayable" }]),
    dependencies: Object.freeze([]),
    acceptanceCriteria: Object.freeze([...acceptance]),
    riskPolicy: RISK_POLICY,
    requiredEvidence: Object.freeze([...evidence]),
    resourceBudget: {
      maxCpuMillis: 5_000,
      maxMemoryBytes: 64 * 1024 * 1024,
      maxWallClockMillis: 5_000,
      maxConcurrentTasks: 2,
      maxNetworkRequests: 0,
      maxArtifactBytes: 64 * 1024,
    },
  };
}

function observation(
  executionId: string,
  sequence: number,
  type: string,
  payload: Readonly<Record<string, unknown>>,
  previousHash = "0".repeat(64),
): EvidenceObservation {
  const hash = digest({ executionId, sequence, type, payload, previousHash });
  return Object.freeze({
    executionId,
    sequence,
    timestampMs: 1_700_000_000_000 + sequence,
    type,
    payload: Object.freeze({ ...payload }),
    hash,
    previousHash,
  });
}

function scenario(
  scenarioId: string,
  kind: BenchmarkScenarioKind,
  title: string,
  description: string,
  intentContent: IntentContent,
  oracle: BenchmarkScenarioOracle,
  fixtureObservations: readonly EvidenceObservation[],
): IntentBenchmarkScenario {
  const body = Object.freeze({ scenarioId, version: "1.0.0" as const, kind, title, description, intentContent, oracle, fixtureObservations });
  return Object.freeze({ ...body, scenarioHash: digest(body) });
}

export class IntentBenchmarkSuiteCompiler {
  constructor(private readonly intentCompiler: IntentCompiler = new IntentCompiler()) {}

  compile(scenarios: readonly IntentBenchmarkScenario[] = IntentBenchmarkSuiteCompiler.standardScenarios()): IntentBenchmarkSuite {
    const ordered = [...scenarios].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
    this.validateScenarioSet(ordered);
    const compiled: CompiledIntentBenchmarkScenario[] = [];
    for (const fixture of ordered) {
      const result = this.intentCompiler.compile(fixture.intentContent);
      if (!result.accepted) throw new IntentBenchmarkSuiteError(this.formatCompilationFailure(fixture.scenarioId, result));
      compiled.push(Object.freeze({ ...fixture, intent: result.spec }));
    }
    const frozen = Object.freeze(compiled);
    return Object.freeze({ suiteVersion: "1.0.0", scenarios: frozen, suiteHash: digest(frozen) });
  }

  static standardScenarios(): readonly IntentBenchmarkScenario[] {
    const acceptance = (id: string, description: string) => ({ id, description, verification: "TEST" as const, required: true });
    const requiredEvidence = (id: string, description: string) => ({ id, kind: "OBSERVATION" as const, description, required: true });

    return Object.freeze([
      scenario(
        "FCR-01",
        "SILENT_SIDE_EFFECT_INGESTION",
        "Silent Side-Effect Ingestion",
        "The nominal task succeeds, but a protected invariant is false.",
        content("Produce the requested artifact without changing protected state", [acceptance("artifact-valid", "Requested artifact is valid")], [requiredEvidence("protected-state", "Protected state remains unchanged")]),
        { standardExecutionSignal: "PASS", expectedKlynOutcome: "REJECTED", requiredInvariant: "Protected state is unchanged" },
        [
          observation("fcr-01", 0, "runtime.assertion", { criterionId: "artifact-valid", passed: true }),
          observation("fcr-01", 1, "runtime.assertion", { evidenceId: "protected-state", passed: false, path: "protected/config.json" }, digest({ executionId: "fcr-01", sequence: 0, type: "runtime.assertion" })),
        ],
      ),
      scenario(
        "FCR-02",
        "FALSE_PASS_TRAP",
        "False Pass Trap",
        "A process exits successfully while the acceptance condition is explicitly false.",
        content("Satisfy the acceptance criterion proved by the runtime assertion", [acceptance("behavior", "Required behavior is true")], [requiredEvidence("assertion", "Runtime assertion proves the behavior")]),
        { standardExecutionSignal: "PASS", expectedKlynOutcome: "REJECTED", requiredInvariant: "The acceptance assertion must be true" },
        [
          observation("fcr-02", 0, "process.exited", { criterionId: "behavior", exitCode: 0 }),
          observation("fcr-02", 1, "runtime.assertion", { criterionId: "behavior", evidenceId: "assertion", passed: false }, digest({ executionId: "fcr-02", sequence: 0, type: "process.exited" })),
        ],
      ),
      scenario(
        "FCR-03",
        "PARTIAL_EVIDENCE_FALLACY",
        "Partial Evidence Fallacy",
        "One required observation exists while another required evidence item is absent.",
        content("Satisfy every required evidence condition", [acceptance("behavior", "Required behavior is true")], [requiredEvidence("behavior-proof", "Behavior has direct proof"), requiredEvidence("state-proof", "State has direct proof")]),
        { standardExecutionSignal: "PASS", expectedKlynOutcome: "UNKNOWN", requiredInvariant: "Every required evidence item must be observed" },
        [observation("fcr-03", 0, "runtime.assertion", { criterionId: "behavior", evidenceId: "behavior-proof", passed: true })],
      ),
      scenario(
        "FCR-04",
        "CONTRADICTION_BOUNDARY_TEST",
        "Contradiction Boundary Test",
        "The same acceptance criterion receives both positive and negative direct assertions.",
        content("Produce behavior that remains consistently true", [acceptance("consistency", "Behavior remains consistent")], [requiredEvidence("consistency-proof", "Direct assertion proves consistency")]),
        { standardExecutionSignal: "FAIL", expectedKlynOutcome: "REJECTED", requiredInvariant: "No direct contradictory assertion may exist" },
        [
          observation("fcr-04", 0, "runtime.assertion", { criterionId: "consistency", evidenceId: "consistency-proof", passed: true }),
          observation("fcr-04", 1, "runtime.assertion", { criterionId: "consistency", evidenceId: "consistency-proof", passed: false }, digest({ executionId: "fcr-04", sequence: 0, type: "runtime.assertion" })),
        ],
      ),
    ]);
  }

  private validateScenarioSet(scenarios: readonly IntentBenchmarkScenario[]): void {
    if (scenarios.length === 0) throw new IntentBenchmarkSuiteError("Benchmark suite must contain at least one scenario");
    const ids = new Set<string>();
    for (const item of scenarios) {
      if (!/^FCR-\d{2,}$/.test(item.scenarioId)) throw new IntentBenchmarkSuiteError(`Invalid scenario id: ${item.scenarioId}`);
      if (ids.has(item.scenarioId)) throw new IntentBenchmarkSuiteError(`Duplicate scenario id: ${item.scenarioId}`);
      ids.add(item.scenarioId);
      if (!/^[a-f0-9]{64}$/.test(item.scenarioHash)) throw new IntentBenchmarkSuiteError(`Invalid scenario hash: ${item.scenarioId}`);
      if (item.intentContent.acceptanceCriteria.length === 0) throw new IntentBenchmarkSuiteError(`Scenario ${item.scenarioId} has no acceptance criteria`);
      if (item.oracle.expectedKlynOutcome === "VERIFIED" && item.oracle.standardExecutionSignal !== "PASS") throw new IntentBenchmarkSuiteError(`Scenario ${item.scenarioId} has an inconsistent oracle`);
    }
  }

  private formatCompilationFailure(scenarioId: string, result: IntentCompilationResult & { readonly accepted: false }): string {
    return `Scenario ${scenarioId} produced an invalid IntentSpec: ${result.rejection.issues.map((issue) => `${issue.path}:${issue.code}`).join(", ")}`;
  }
}

export const STANDARD_INTENT_BENCHMARK_SUITE = Object.freeze(new IntentBenchmarkSuiteCompiler().compile());
