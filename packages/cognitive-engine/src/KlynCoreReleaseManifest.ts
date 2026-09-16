import { createHash, sign, verify, type KeyObject } from "node:crypto";
import { BenchmarkRunner, type BenchmarkRunArtifact } from "./BenchmarkRunner.js";
import { EpistemicMetricEvaluator } from "./EpistemicMetricEvaluator.js";

export type KlynCorePlane = "INTENT" | "COGNITION" | "EXECUTION" | "EVIDENCE" | "GOVERNANCE";

export interface KlynCorePlaneContract {
  readonly plane: KlynCorePlane;
  readonly version: "1.0.0";
  readonly packageName: string;
  readonly exportedContracts: readonly string[];
  readonly contractHash: string;
}

export interface CoreReleaseSigner {
  readonly algorithm: "ed25519";
  sign(payload: Buffer): string;
  verify(payload: Buffer, signature: string): boolean;
}

export class Ed25519CoreReleaseSigner implements CoreReleaseSigner {
  readonly algorithm = "ed25519" as const;

  constructor(
    private readonly privateKey: KeyObject,
    private readonly publicKey: KeyObject,
  ) {}

  sign(payload: Buffer): string {
    return sign(null, payload, this.privateKey).toString("base64");
  }

  verify(payload: Buffer, signature: string): boolean {
    return verify(null, payload, this.publicKey, Buffer.from(signature, "base64"));
  }
}

export interface ReleaseAuditChainEntry {
  readonly scenarioId: string;
  readonly previousChainHash: string;
  readonly intentHash: string;
  readonly cognitionHash: string;
  readonly executionHash: string;
  readonly evidenceHash: string;
  readonly governanceHash: string;
  readonly chainHash: string;
}

export interface KlynCoreReleaseManifest {
  readonly manifestVersion: "1.0.0";
  readonly coreVersion: "1.0.0";
  readonly suiteHash: string;
  readonly benchmarkRunHash: string;
  readonly planeContractHashes: Readonly<Record<KlynCorePlane, string>>;
  readonly auditHashChain: readonly ReleaseAuditChainEntry[];
  readonly benchmarkMetrics: {
    readonly objectiveVerificationAccuracy: number;
    readonly falseCompletionRate: number;
    readonly standardLlmFalseCompletionRate: number;
    readonly oracleOutcomeAccuracy: number;
  };
  readonly signerAlgorithm: "ed25519";
  readonly signature: string;
  readonly manifestHash: string;
}

export interface KlynCoreReleaseInput {
  readonly benchmarkRun: BenchmarkRunArtifact;
  readonly planeContracts: readonly KlynCorePlaneContract[];
  readonly oracleOutcomeAccuracy: number;
  readonly signer: CoreReleaseSigner;
}

export class KlynCoreReleaseManifestError extends Error {
  readonly code = "KLYN_CORE_RELEASE_MANIFEST_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "KlynCoreReleaseManifestError";
  }
}

const EMPTY_HASH = "0".repeat(64);
const PLANES: readonly KlynCorePlane[] = Object.freeze([
  "INTENT",
  "COGNITION",
  "EXECUTION",
  "EVIDENCE",
  "GOVERNANCE",
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

function assertDigest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new KlynCoreReleaseManifestError(`${label} must be a SHA-256 hex digest`);
}

function freezeContract(contract: KlynCorePlaneContract): KlynCorePlaneContract {
  const canonical = {
    plane: contract.plane,
    version: contract.version,
    packageName: contract.packageName,
    exportedContracts: Object.freeze([...contract.exportedContracts].sort()),
  };
  const expectedHash = digest(canonical);
  if (contract.contractHash !== expectedHash) {
    throw new KlynCoreReleaseManifestError(`Contract hash mismatch for ${contract.plane}`);
  }
  return Object.freeze({ ...canonical, contractHash: contract.contractHash });
}

export function buildPlaneContract(
  plane: KlynCorePlane,
  packageName: string,
  exportedContracts: readonly string[],
): KlynCorePlaneContract {
  const canonical = {
    plane,
    version: "1.0.0" as const,
    packageName,
    exportedContracts: Object.freeze([...exportedContracts].sort()),
  };
  return Object.freeze({ ...canonical, contractHash: digest(canonical) });
}

export const KLYN_CORE_PLANE_CONTRACTS: readonly KlynCorePlaneContract[] = Object.freeze([
  buildPlaneContract("INTENT", "@klyn/cognitive-engine", ["IntentSpec", "IntentCompiler", "IntentStateMachine", "TaskGraphCompiler"]),
  buildPlaneContract("COGNITION", "@klyn/cognitive-engine", ["ExecutionPlanner", "SwarmTaskDispatcher", "ConsensusArbitrator", "WorldModel"]),
  buildPlaneContract("EXECUTION", "@klyn/execution-runtime", ["SandboxPolicyEngine", "PolicyGovernedSandbox", "ObservationCollector"]),
  buildPlaneContract("EVIDENCE", "@klyn/cognitive-engine", ["EvidenceGraphBuilder", "ClaimsVerifier", "EpistemicAuditEngine"]),
  buildPlaneContract("GOVERNANCE", "@klyn/cognitive-engine", ["GovernancePolicyEngine", "PromotionController", "GovernanceOrchestrator"]),
]);

function contractHashMap(contracts: readonly KlynCorePlaneContract[]): Readonly<Record<KlynCorePlane, string>> {
  const normalized = contracts.map(freezeContract);
  if (normalized.length !== PLANES.length) throw new KlynCoreReleaseManifestError("Exactly five plane contracts are required");
  const map = {} as Record<KlynCorePlane, string>;
  const seen = new Set<KlynCorePlane>();
  for (const contract of normalized) {
    if (seen.has(contract.plane)) throw new KlynCoreReleaseManifestError(`Duplicate plane contract: ${contract.plane}`);
    seen.add(contract.plane);
    map[contract.plane] = contract.contractHash;
  }
  for (const plane of PLANES) {
    if (!seen.has(plane)) throw new KlynCoreReleaseManifestError(`Missing plane contract: ${plane}`);
  }
  return Object.freeze(map);
}

function governanceHash(run: BenchmarkRunArtifact["scenarios"][number]): string {
  const promotion = run.governanceResult.promotion;
  return digest({
    state: run.governanceResult.governance,
    promotionState: promotion.state,
    promotionManifestHash: promotion.manifest?.manifestHash ?? null,
    promotionReason: promotion.reason ?? null,
  });
}

function cognitionHash(run: BenchmarkRunArtifact["scenarios"][number]): string {
  return digest({
    graph: run.governanceResult.graph,
    strategy: run.governanceResult.strategy,
    dispatch: run.governanceResult.dispatch,
  });
}

function executionHash(run: BenchmarkRunArtifact["scenarios"][number]): string {
  return run.observationHash;
}

function evidenceHash(run: BenchmarkRunArtifact["scenarios"][number]): string {
  return run.governanceResult.audit.proofDigest;
}

function intentHash(run: BenchmarkRunArtifact["scenarios"][number]): string {
  return run.governanceResult.graph.contentHash;
}

function buildAuditHashChain(scenarios: BenchmarkRunArtifact["scenarios"]): readonly ReleaseAuditChainEntry[] {
  let previousChainHash = EMPTY_HASH;
  const entries: ReleaseAuditChainEntry[] = [];
  for (const scenario of [...scenarios].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))) {
    const entryBody = {
      scenarioId: scenario.scenarioId,
      previousChainHash,
      intentHash: intentHash(scenario),
      cognitionHash: cognitionHash(scenario),
      executionHash: executionHash(scenario),
      evidenceHash: evidenceHash(scenario),
      governanceHash: governanceHash(scenario),
    };
    for (const [label, value] of Object.entries(entryBody)) {
      if (label !== "scenarioId" && label !== "previousChainHash") assertDigest(value, label);
    }
    const chainHash = digest(entryBody);
    const entry = Object.freeze({ ...entryBody, chainHash });
    entries.push(entry);
    previousChainHash = chainHash;
  }
  return Object.freeze(entries);
}

export class KlynCoreReleaseManifestCompiler {
  compile(input: KlynCoreReleaseInput): KlynCoreReleaseManifest {
    if (!BenchmarkRunner.verifyArtifact(input.benchmarkRun, new EpistemicMetricEvaluator())) {
      throw new KlynCoreReleaseManifestError("Benchmark run artifact failed cryptographic verification");
    }
    if (!Number.isFinite(input.oracleOutcomeAccuracy) || input.oracleOutcomeAccuracy < 0 || input.oracleOutcomeAccuracy > 1) {
      throw new KlynCoreReleaseManifestError("oracleOutcomeAccuracy must be between 0 and 1");
    }

    const planeContractHashes = contractHashMap(input.planeContracts);
    const auditHashChain = buildAuditHashChain(input.benchmarkRun.scenarios);
    const unsigned = {
      manifestVersion: "1.0.0" as const,
      coreVersion: "1.0.0" as const,
      suiteHash: input.benchmarkRun.suiteHash,
      benchmarkRunHash: input.benchmarkRun.runHash,
      planeContractHashes,
      auditHashChain,
      benchmarkMetrics: Object.freeze({
        objectiveVerificationAccuracy: input.benchmarkRun.resultManifest.metrics.objectiveVerificationAccuracy,
        falseCompletionRate: input.benchmarkRun.resultManifest.metrics.falseCompletionRate,
        standardLlmFalseCompletionRate: input.benchmarkRun.resultManifest.standardLlmBaseline.falseCompletionRate,
        oracleOutcomeAccuracy: input.oracleOutcomeAccuracy,
      }),
      signerAlgorithm: "ed25519" as const,
    };

    const payload = Buffer.from(JSON.stringify(canonicalize(unsigned)), "utf8");
    const signature = input.signer.sign(payload);
    if (!input.signer.verify(payload, signature)) throw new KlynCoreReleaseManifestError("Release signature self-verification failed");
    const manifestHash = digest({ ...unsigned, signature });

    return deepFreeze({ ...unsigned, signature, manifestHash });
  }

  verify(manifest: KlynCoreReleaseManifest, signer: CoreReleaseSigner): boolean {
    const { signature, manifestHash, ...body } = manifest;
    const payload = Buffer.from(JSON.stringify(canonicalize({ ...body })), "utf8");
    return signer.verify(payload, signature) && digest({ ...body, signature }) === manifestHash;
  }
}
