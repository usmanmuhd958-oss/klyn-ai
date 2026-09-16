// =============================================================================
// KLYN AI OS — 1.brain — End-to-End Autonomous Epoch Drive (Phase 9)
// File: 1.brain/e2e_autonomous_epoch.ts
//
// Phase 9 capability #1. The single executable pipeline that closes the loop
// between sensing and evolution. One `drive()` call walks the FULL chain:
//
//   Red-Team Fuzzer / Profiler Finding
//     → Swarm Consensus Vote (Architect · Modder · Auditor · Tester)
//     → Transactional Patcher (atomic multi-file commit, rollback on dissent)
//     → Quality Gate Validation (syntax + unhandled-rejection + coverage)
//     → Post-Quantum Merkle Signed Commit (WOTS+ ledger + Merkle audit)
//     → Experience Learner Ingest
//     → Adaptive Policy Update (regression-guarded, Merkle-signed)
//
// The driver is dependency-injected (every engine can be swapped or left
// out) and fully headless — no human intervention, no UI, no blocking I/O
// beyond the patcher's atomic write. With a `persistence` adapter wired, the
// whole chain's outcomes are written to the Phase 9 durable ledger so a
// process restart can cold-boot the learned state.
//
//   const driver = new EpochDriver({ swarm, gate, quantum, merkle, learner, policy, persistence });
//   const outcome = await driver.drive(finding);           // one full epoch
//   await driver.drivePending(fuzzer, profiler, resolve);  // continuous sweep
// =============================================================================
import { readFile } from 'node:fs/promises';
import { EventBus, type KlynEvent } from '../packages/core-runtime/src/EventBus.js';
import { PatchPlanner } from './patch_planner.js';
import { AgentSwarm, type SwarmVote } from './swarm/AgentSwarm.js';
import { TransactionalPatcher } from '../2.body/transactional_patcher.js';
import { QualityGate } from '../packages/self-healing-runtime/src/mutation_harness.js';
import { QuantumZkLedger } from '../kernel/src/security/quantum_zk.js';
import MerkleAudit from '../kernel/src/security/merkle_audit.js';
import { ExperienceLearner, type ExperienceStats } from './experience_learner.js';
import { AdaptivePolicyEngine } from './adaptive_policy.js';
import { synthesizeHotpatch, type FuzzFinding, type RedTeamFuzzer } from './red_team_fuzzer.js';
import type { RuntimeProfiler, Violation } from './runtime_profiler.js';
import type { EnginePersistence } from '../kernel/src/storage/persistent_ledger.js';
import type { FileOperation } from './patch_generator.js';

export type EpochSource = 'fuzzer' | 'profiler' | 'manual' | 'self';

export interface EpochFinding {
  source: EpochSource;
  /** Route / endpoint identifier under attack or breach. */
  route: string;
  /** Absolute path of the file the defensive patch will harden. */
  filePath: string;
  detail: string;
  /** Payload kind (fuzzer) or violation kind (profiler). */
  kind: string;
  severity: string;
  at: number;
}

export interface EpochOutcome {
  ok: boolean;
  finding: EpochFinding;
  query: string;
  votes: SwarmVote[];
  committed: boolean;
  gateApproved: boolean;
  filesWritten: string[];
  finalContent: string | null;
  /** Post-quantum ledger seq of the signed commit (null when unwired/failed). */
  quantumSeq: number | null;
  quantumRoot: string | null;
  merkleRoot: string | null;
  learnerStats: ExperienceStats | null;
  policyVersion: number;
  policyActivated: boolean;
  errors: string[];
  latencyMs: number;
  at: number;
}

export interface EpochDriveOptions {
  bus?: EventBus;
  planner?: PatchPlanner;
  swarm?: AgentSwarm;
  patcher?: TransactionalPatcher;
  gate?: QualityGate;
  /** Post-quantum WOTS+ ledger — every committed epoch is signed here. */
  quantum?: QuantumZkLedger;
  /** Phase 4 Merkle audit — every committed epoch is chained here. */
  merkle?: MerkleAudit;
  learner?: ExperienceLearner;
  policy?: AdaptivePolicyEngine;
  /** Phase 9 durable store — epoch outcomes survive restarts. */
  persistence?: EnginePersistence;
  /** Propose a policy candidate every N successful patches (default 4). */
  proposeEvery?: number;
  /** Phase 10 self-hosting: inject a custom candidate synthesizer. Defaults
   *  to `synthesizeDefensivePatch` (unchanged Phase 9 behavior). */
  synthesize?: (original: string, finding: EpochFinding) => string;
}

const DEFAULT_PROPOSE_EVERY = 4;
const MAX_DRIVEN_KEYS = 1024;

export class EpochDriver {
  private bus: EventBus;
  private planner: PatchPlanner;
  private swarm: AgentSwarm;
  private patcher: TransactionalPatcher;
  private gate: QualityGate;
  private quantum?: QuantumZkLedger;
  private merkle?: MerkleAudit;
  private learner: ExperienceLearner;
  private policy: AdaptivePolicyEngine;
  private persistence?: EnginePersistence;
  private readonly proposeEvery: number;
  private readonly synthesize: (original: string, finding: EpochFinding) => string;
  private patchCount = 0;
  private drivenKeys = new Set<string>();

  constructor(options: EpochDriveOptions = {}) {
    this.bus = options.bus ?? new EventBus();
    this.planner = options.planner ?? new PatchPlanner();
    this.patcher = options.patcher ?? new TransactionalPatcher();
    this.swarm = options.swarm ?? new AgentSwarm(this.planner, this.patcher);
    this.gate = options.gate ?? new QualityGate();
    this.quantum = options.quantum;
    this.merkle = options.merkle;
    this.learner = options.learner ?? new ExperienceLearner();
    this.policy = options.policy ?? new AdaptivePolicyEngine();
    this.persistence = options.persistence;
    this.proposeEvery = options.proposeEvery ?? DEFAULT_PROPOSE_EVERY;
    this.synthesize = options.synthesize ?? synthesizeDefensivePatch;
  }

  // -------------------------------------------------------------------------
  // THE FULL EPOCH
  // -------------------------------------------------------------------------

  /**
   * Drive ONE complete autonomous epoch for a finding. Runs the entire chain
   * with no human intervention and returns a full outcome receipt (votes,
   * signed commit seqs, roots, learned stats, policy version). Never throws —
   * every failure mode is captured in the outcome.
   */
  async drive(finding: EpochFinding, repoRoot: string = process.cwd(), query?: string): Promise<EpochOutcome> {
    const t0 = performance.now();
    const q = query ?? `${finding.source}:${finding.kind} on ${finding.route}`;
    const errors: string[] = [];
    const outcome: EpochOutcome = {
      ok: false,
      finding,
      query: q,
      votes: [],
      committed: false,
      gateApproved: false,
      filesWritten: [],
      finalContent: null,
      quantumSeq: null,
      quantumRoot: null,
      merkleRoot: null,
      learnerStats: null,
      policyVersion: this.policy.activeVersion,
      policyActivated: false,
      errors,
      latencyMs: 0,
      at: Date.now(),
    };

    this.bus.publish({ type: 'epoch:start', payload: { source: finding.source, route: finding.route, kind: finding.kind }, timestamp: Date.now() } satisfies KlynEvent);

    // 1) Read the target file — a vanished handler aborts the epoch.
    const original = await readFile(finding.filePath, 'utf-8').catch(() => null);
    if (original === null) {
      errors.push(`handler file unreadable: ${finding.filePath}`);
      return this.recordFailure(outcome, t0);
    }

    // 2) Synthesize the candidate + fail-fast quality gate. The Phase 10
    //    self-hosting loop injects its own self-repair synthesizer here; the
    //    default keeps the Phase 9 defensive-patch behavior byte-identical.
    const candidate = this.synthesize(original, finding);
    if (candidate.length === 0 || candidate === original) {
      errors.push('defensive patch synthesizer produced no change');
      return this.recordFailure(outcome, t0);
    }
    const preGate = this.gate.evaluate({ code: candidate });
    outcome.gateApproved = preGate.approved;
    if (!preGate.approved) {
      errors.push(`quality gate rejected candidate: ${preGate.reasons.join('; ')}`);
      return this.recordFailure(outcome, t0);
    }

    // 3) Swarm consensus → transactional patch. The four agents vote on
    //    private forks; the epoch commits atomically only on unanimous
    //    approval (orchestrator timeout → rollback).
    const op: FileOperation = { type: 'modify', path: finding.filePath, oldContent: original, newContent: candidate };
    const epoch = await this.swarm.runEpochOps([op], q, { repoRoot, requireTester: true });
    outcome.votes = epoch.votes;
    outcome.filesWritten = epoch.filesWritten;
    outcome.committed = epoch.committed;
    if (!epoch.committed || epoch.errors.length > 0) {
      errors.push(...epoch.errors.length > 0 ? epoch.errors : ['swarm consensus rejected the epoch']);
      return this.recordFailure(outcome, t0);
    }

    // 4) Post-commit verification: re-read the applied file and re-gate the
    //    FINAL content (belt-and-braces — the swarm compiled a projection,
    //    this checks what actually landed on disk).
    const final = await readFile(finding.filePath, 'utf-8').catch(() => null);
    if (final === null) {
      errors.push('committed file vanished before verification');
      return this.recordFailure(outcome, t0);
    }
    outcome.finalContent = final;
    const postGate = this.gate.evaluate({ code: final });
    if (!postGate.approved) {
      errors.push(`post-commit gate failed: ${postGate.reasons.join('; ')}`);
      return this.recordFailure(outcome, t0);
    }

    // 5) Post-quantum + Merkle signed commit (non-repudiable audit trail).
    const ref = finding.filePath;
    if (this.quantum) {
      const record = this.quantum.commitMutation('patch', ref, original, final, {
        source: finding.source,
        route: finding.route,
        kind: finding.kind,
        severity: finding.severity,
      });
      outcome.quantumSeq = record.seq;
      outcome.quantumRoot = record.root;
    }
    if (this.merkle) {
      outcome.merkleRoot = this.merkle.commitFile(ref, final, { source: finding.source, route: finding.route, kind: finding.kind, at: finding.at }).root;
    }

    // 6) Experience learner ingest.
    const latencyMs = performance.now() - t0;
    this.learner.record('patch', ref, true, latencyMs, `${finding.source}:${finding.kind} healed`);
    this.learner.record('route', finding.route, true, latencyMs);
    outcome.learnerStats = this.learner.query('patch');

    // 7) Adaptive policy update (regression-guarded, cadence-bounded).
    this.policy.observe(true, latencyMs);
    this.patchCount++;
    if (this.patchCount % this.proposeEvery === 0) {
      const draft = this.policy.proposeFromLearner(this.learner);
      const patch = this.learner.query('patch');
      const activation = this.policy.activate(draft, { successRate: patch?.successRate, avgLatencyMs: patch?.avgLatencyMs });
      outcome.policyActivated = activation.ok;
      if (activation.ok) {
        this.bus.publish({ type: 'epoch:policy_activated', payload: { version: activation.version, root: activation.root }, timestamp: Date.now() } satisfies KlynEvent);
      }
    }
    outcome.policyVersion = this.policy.activeVersion;

    // 8) Durable persistence (cold-boot survival).
    await this.persistOutcome(finding, original, final, outcome);

    outcome.ok = true;
    return this.finish(outcome, t0);
  }

  // -------------------------------------------------------------------------
  // FINDING SOURCES
  // -------------------------------------------------------------------------

  /** Normalize a Phase 6 fuzzer finding into an epoch finding. The caller
   *  supplies the filePath (the fuzzer finding carries the route only). */
  fromFuzzFinding(finding: FuzzFinding, filePath: string): EpochFinding {
    return {
      source: 'fuzzer',
      route: finding.route,
      filePath,
      detail: finding.detail,
      kind: finding.kind,
      severity: finding.severity,
      at: finding.at,
    };
  }

  /** Normalize a profiler violation + route into an epoch finding. The file
   *  path comes from the profiler sample that carried it. */
  fromViolation(route: string, violations: Violation[], filePath: string): EpochFinding {
    const primary = violations[0];
    return {
      source: 'profiler',
      route,
      filePath,
      detail: violations.map((v) => `${v.kind} (${v.observed.toFixed(1)} vs SLA ${v.threshold})`).join('; '),
      kind: primary?.kind ?? 'latency',
      severity: primary?.kind ?? 'latency',
      at: Date.now(),
    };
  }

  /** Drive the highest-priority violation of a route (profiler-driven). */
  async driveViolation(route: string, profiler: RuntimeProfiler, repoRoot?: string): Promise<EpochOutcome> {
    const violations = profiler.evaluate(route);
    if (violations.length === 0) {
      return {
        ok: false,
        finding: { source: 'profiler', route, filePath: '', detail: 'no active violation', kind: 'none', severity: 'none', at: Date.now() },
        query: `profiler:${route}`,
        votes: [],
        committed: false,
        gateApproved: false,
        filesWritten: [],
        finalContent: null,
        quantumSeq: null,
        quantumRoot: null,
        merkleRoot: null,
        learnerStats: null,
        policyVersion: this.policy.activeVersion,
        policyActivated: false,
        errors: ['no active violation for route'],
        latencyMs: 0,
        at: Date.now(),
      };
    }
    // The profiler records filePath per sample; the driver heals the file
    // the breach actually happened in.
    const samplePath = profiler.sampleFilePath(route);
    if (!samplePath) {
      return {
        ok: false,
        finding: { source: 'profiler', route, filePath: '', detail: violations.map((v) => v.kind).join(';'), kind: violations[0]?.kind ?? 'latency', severity: 'latency', at: Date.now() },
        query: `profiler:${route}`,
        votes: [],
        committed: false,
        gateApproved: false,
        filesWritten: [],
        finalContent: null,
        quantumSeq: null,
        quantumRoot: null,
        merkleRoot: null,
        learnerStats: null,
        policyVersion: this.policy.activeVersion,
        policyActivated: false,
        errors: ['no filePath recorded for route samples'],
        latencyMs: 0,
        at: Date.now(),
      };
    }
    return this.drive(this.fromViolation(route, violations, samplePath), repoRoot);
  }

  /**
   * Continuous sweep: drive every not-yet-driven finding from the fuzzer
   * (route → filePath resolved by the callback) and every breached profiler
   * route. Deduplication is bounded, so a long-running driver never grows
   * unbounded memory and never re-heals the same finding twice.
   */
  async drivePending(
    fuzzer?: RedTeamFuzzer,
    profiler?: RuntimeProfiler,
    resolveFilePath?: (finding: FuzzFinding) => string | null,
    repoRoot?: string
  ): Promise<EpochOutcome[]> {
    const outcomes: EpochOutcome[] = [];
    if (fuzzer) {
      for (const finding of fuzzer.recentFindings(64)) {
        const filePath = resolveFilePath?.(finding) ?? null;
        if (!filePath) continue;
        const key = `fuzzer:${finding.route}:${finding.kind}:${finding.at}`;
        if (this.drivenKeys.has(key)) continue;
        this.drivenKeys.add(key);
        this.trimDrivenKeys();
        outcomes.push(await this.drive(this.fromFuzzFinding(finding, filePath), repoRoot));
      }
    }
    if (profiler) {
      for (const route of profiler.routes()) {
        const violations = profiler.evaluate(route);
        if (violations.length === 0) continue;
        const key = `profiler:${route}:${violations[0].kind}:${violations[0].observed}`;
        if (this.drivenKeys.has(key)) continue;
        this.drivenKeys.add(key);
        this.trimDrivenKeys();
        outcomes.push(await this.driveViolation(route, profiler, repoRoot));
      }
    }
    return outcomes;
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  getStats(): { patchesDriven: number; drivenKeys: number; policyVersion: number; patchSuccessRate: number | null } {
    const patch = this.learner.query('patch');
    return {
      patchesDriven: this.patchCount,
      drivenKeys: this.drivenKeys.size,
      policyVersion: this.policy.activeVersion,
      patchSuccessRate: patch?.successRate ?? null,
    };
  }

  /** Bound the dedupe table (oldest keys evicted first). */
  private trimDrivenKeys(): void {
    if (this.drivenKeys.size <= MAX_DRIVEN_KEYS) return;
    const overflow = this.drivenKeys.size - MAX_DRIVEN_KEYS;
    let removed = 0;
    for (const key of this.drivenKeys) {
      if (removed >= overflow) break;
      this.drivenKeys.delete(key);
      removed++;
    }
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private async recordFailure(outcome: EpochOutcome, t0: number): Promise<EpochOutcome> {
    const latencyMs = performance.now() - t0;
    const ref = outcome.finding.filePath || `${outcome.finding.source}:${outcome.finding.route}`;
    this.learner.record('patch', ref, false, latencyMs, outcome.errors[0] ?? 'epoch failed');
    this.policy.observe(false, latencyMs);
    outcome.learnerStats = this.learner.query('patch');
    outcome.policyVersion = this.policy.activeVersion;
    if (this.persistence) {
      await this.persistence.persistLearnerRecord(this.learner, 'patch', ref, false, latencyMs, outcome.errors[0] ?? 'epoch failed');
      await this.persistence.persistPolicyEvent(this.policy, { type: 'observe', success: false, latencyMs });
    }
    return this.finish(outcome, t0);
  }

  private async persistOutcome(finding: EpochFinding, original: string, final: string, outcome: EpochOutcome): Promise<void> {
    if (!this.persistence) return;
    if (this.quantum) {
      // The persisted meta must be byte-identical to the meta used by the
      // in-memory commitMutation — replay reproduces roots only when the
      // event stream matches the original signing inputs exactly.
      await this.persistence.persistQuantumMutation(this.quantum, 'patch', finding.filePath, original, final, {
        source: finding.source,
        route: finding.route,
        kind: finding.kind,
        severity: finding.severity,
      });
    }
    await this.persistence.persistLearnerRecord(this.learner, 'patch', finding.filePath, true, outcome.latencyMs, `${finding.source}:${finding.kind} healed`);
    await this.persistence.persistPolicyEvent(this.policy, { type: 'observe', success: true, latencyMs: outcome.latencyMs });
    if (outcome.policyActivated) {
      await this.persistence.persistPolicyEvent(this.policy, { type: 'activate', draft: this.policy.active, baseline: { successRate: this.learner.query('patch')?.successRate, avgLatencyMs: this.learner.query('patch')?.avgLatencyMs } });
    }
  }

  private finish(outcome: EpochOutcome, t0: number): EpochOutcome {
    outcome.latencyMs = performance.now() - t0;
    this.bus.publish({ type: 'epoch:outcome', payload: outcome, timestamp: Date.now() } satisfies KlynEvent);
    return outcome;
  }
}

// -----------------------------------------------------------------------------
// DEFENSIVE PATCH SYNTHESIS (deterministic, syntax-safe prepend)
// -----------------------------------------------------------------------------

/**
 * Synthesize the defensive hardening candidate for a finding. Fuzzer findings
 * reuse the Phase 6 red-team sanitizer guard; profiler findings get a
 * module-level memoization cache (the Phase 4 SLA-repair pattern). Both are
 * syntax-safe prepends that the QualityGate re-verifies before the swarm
 * votes on them.
 */
export function synthesizeDefensivePatch(original: string, finding: EpochFinding): string {
  if (finding.source === 'fuzzer') {
    const fuzzLike = {
      route: finding.route,
      method: 'POST',
      kind: finding.kind,
      payloadName: finding.kind,
      severity: finding.severity,
      status: 0,
      detail: finding.detail,
      at: finding.at,
    } as unknown as FuzzFinding;
    return synthesizeHotpatch(original, fuzzLike);
  }
  const guard = `// [klyn-epoch] SLA repair ${finding.at} — module-level memoization cache (auto-generated)\nconst __klynRouteCache = new Map<string, unknown>();\nfunction __klynMemo(key: string, compute: () => unknown): unknown {\n  if (__klynRouteCache.has(key)) return __klynRouteCache.get(key);\n  const value = compute();\n  __klynRouteCache.set(key, value);\n  return value;\n}\n`;
  return `${guard}\n${original}`;
}

export default EpochDriver;
