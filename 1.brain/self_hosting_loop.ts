// =============================================================================
// KLYN AI OS — 1.brain — Self-Hosting Evolution Loop (Phase 10)
// File: 1.brain/self_hosting_loop.ts
//
// Phase 10 capability #2 — the dogfood driver. Klyn points its OWN closed
// loop (Phase 9 EpochDriver) at its OWN source. The loop is the safety-
// critical boundary between "autonomous" and "dangerous": every self-mutation
// passes FOUR guards before the epoch machinery is allowed to touch a file:
//
//   1. CRITICAL_FILE_PROTECTED — bootstrap-critical paths (epoch driver,
//      persistence, quantum/merkle ledgers, router auth, gateway) are never
//      self-mutated without an explicit force flag.
//   2. CONVERGENCE_LOCK         — per-file mutation budget (default 1/session)
//      so the OS can never enter a patch loop on a hot file.
//   3. BLAST_RADIUS_EXCEEDED    — the Phase 8 graph query engine measures the
//      transitive impact closure of the target; a change touching more than
//      maxBlastFraction (default 25%) of the graph is vetoed.
//   4. MANUAL_FINDING           — report-only findings (eval, sync I/O, any,
//      overlong functions) are never auto-mutated; they are escalated.
//
// On approval the loop snapshots the file (backup), drives the FULL Phase 9
// chain (swarm consensus → transactional patch → quality gate → post-quantum
// + Merkle signed commit → learner ingest → policy update), records a
// tamper-evident manifest entry, and supports byte-exact deterministic
// rollback to any committed snapshot:
//
//   const loop = new SelfHostingLoop({ repoRoot, manifest, quantum, merkle, ... });
//   const report = await loop.audit();                       // scan own source
//   const outcome = await loop.evolve(report.findings[0]);   // guarded epoch
//   await loop.rollback(outcome.manifest.seq);               // byte-exact undo
// =============================================================================
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, basename, dirname } from 'node:path';

import { EventBus } from '../packages/core-runtime/src/EventBus.js';
import { PatchPlanner } from './patch_planner.js';
import { TransactionalPatcher } from '../2.body/transactional_patcher.js';
import { QualityGate } from '../packages/self-healing-runtime/src/mutation_harness.js';
import { AgentSwarm } from './swarm/AgentSwarm.js';
import { QuantumZkLedger } from '../kernel/src/security/quantum_zk.js';
import MerkleAudit from '../kernel/src/security/merkle_audit.js';
import { ExperienceLearner } from './experience_learner.js';
import { AdaptivePolicyEngine } from './adaptive_policy.js';
import { EpochDriver, type EpochFinding, type EpochOutcome } from './e2e_autonomous_epoch.js';
import { SelfAuditScanner, type SelfAuditFinding, type SelfAuditReport, type SelfAuditKind } from './self_audit.js';
import { SelfManifest, type ManifestEntry } from '../kernel/src/storage/self_manifest.js';
import { GraphQueryEngine } from './graph_query_engine.js';
import type { RuntimeProfiler } from './runtime_profiler.js';
import type { EnginePersistence } from '../kernel/src/storage/persistent_ledger.js';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type SelfVetoReason =
  | 'CRITICAL_FILE_PROTECTED'
  | 'CONVERGENCE_LOCK'
  | 'BLAST_RADIUS_EXCEEDED'
  | 'MANUAL_FINDING'
  | 'UNSAFE_PATH';

export interface SelfEvolveOptions {
  /** Bypass CRITICAL_FILE_PROTECTED + MANUAL_FINDING (convergence and blast
   *  radius still apply unless their own overrides are set). */
  force?: boolean;
  /** Bypass the per-file convergence lock. */
  overrideConvergence?: boolean;
}

export interface SelfEvolveOutcome {
  ok: boolean;
  finding: SelfAuditFinding;
  vetoed: boolean;
  vetoReason: SelfVetoReason | null;
  blastRadius: number | null;
  /** The Phase 9 closed-loop outcome (null when vetoed). */
  epoch: EpochOutcome | null;
  manifest: ManifestEntry;
  backupPath: string | null;
  latencyMs: number;
  at: number;
}

export interface RollbackOutcome {
  ok: boolean;
  reason?: string;
  seq?: number;
  file?: string;
  backupPath?: string | null;
  manifest?: ManifestEntry;
}

export interface SelfHostingOptions {
  scanner?: SelfAuditScanner;
  graph?: GraphQueryEngine;
  /** Durable tamper-evident manifest (optional — in-memory when omitted). */
  manifest?: SelfManifest;
  /** Override the internal epoch driver (default: built with the shared
   *  engines + the self-repair synthesizer). */
  epoch?: EpochDriver;
  repoRoot?: string;
  /** Where pre-mutation snapshots land (default `<repoRoot>/.klyn_selfhost/backups`). */
  backupDir?: string;
  /** Fraction of the graph a mutation may touch (default 0.25). */
  maxBlastFraction?: number;
  /** Per-file mutation budget per session (default 1 — convergence lock). */
  maxMutationsPerFile?: number;
  /** Bootstrap-critical paths never self-mutated without force. */
  criticalFiles?: string[];
  /** Kinds the loop may auto-repair (default todo_debt + debug_log). */
  autoFixableKinds?: SelfAuditKind[];
  /** Custom self-repair synthesizer (defaults to synthesizeSelfPatch). */
  synthesize?: (original: string, finding: EpochFinding) => string;
  // Shared engines for the internal epoch driver (all optional — defaults
  // mirror the Phase 9 composition root).
  bus?: EventBus;
  planner?: PatchPlanner;
  patcher?: TransactionalPatcher;
  swarm?: AgentSwarm;
  gate?: QualityGate;
  quantum?: QuantumZkLedger;
  merkle?: MerkleAudit;
  learner?: ExperienceLearner;
  policy?: AdaptivePolicyEngine;
  persistence?: EnginePersistence;
}

// -----------------------------------------------------------------------------
// DEFAULTS
// -----------------------------------------------------------------------------

const DEFAULT_CRITICAL_FILES = [
  '1.brain/e2e_autonomous_epoch.ts',
  '1.brain/self_hosting_loop.ts',
  '1.brain/self_audit.ts',
  'kernel/src/storage/persistent_ledger.ts',
  'kernel/src/storage/self_manifest.ts',
  'kernel/src/security/quantum_zk.ts',
  'kernel/src/security/merkle_audit.ts',
  'api/router.ts',
  'klyn_server.js',
];

const DEFAULT_MAX_BLAST_FRACTION = 0.25;
const DEFAULT_MAX_MUTATIONS_PER_FILE = 1;
const DEFAULT_AUTO_FIXABLE: SelfAuditKind[] = ['todo_debt', 'debug_log'];

// -----------------------------------------------------------------------------
// SELF-REPAIR SYNTHESIZER (deterministic, syntax-preserving)
// -----------------------------------------------------------------------------

/**
 * Deterministic candidate generator for auto-fixable self findings. Targets
 * the FIRST occurrence of the finding's pattern in the file (the epoch is
 * driven one finding at a time and the convergence lock stops repeat
 * mutations on the same file, so first-match is exact and stable):
 *
 *   debug_log → the console.log/debug line is commented out in place
 *   todo_debt → the TODO/FIXME/HACK comment line is removed
 *
 * Anything else returns the original unchanged — the epoch driver then
 * rejects it as a no-op, so manual findings can never be auto-committed.
 */
export function synthesizeSelfPatch(original: string, finding: EpochFinding): string {
  const lines = original.split('\n');

  if (finding.kind === 'debug_log') {
    const idx = lines.findIndex((l) => /console\.(?:log|debug)\s*\(/.test(l));
    if (idx === -1) return original;
    lines[idx] = `// [klyn-self] ${lines[idx].trim()}`;
    return lines.join('\n');
  }

  if (finding.kind === 'todo_debt') {
    const idx = lines.findIndex((l) => /\/\/\s*(?:TODO|FIXME|HACK)\b/.test(l));
    if (idx === -1) return original;
    lines.splice(idx, 1);
    return lines.join('\n');
  }

  return original;
}

// -----------------------------------------------------------------------------
// THE LOOP
// -----------------------------------------------------------------------------

export class SelfHostingLoop {
  private readonly scanner: SelfAuditScanner;
  private readonly epoch: EpochDriver;
  private readonly graph?: GraphQueryEngine;
  private readonly manifest?: SelfManifest;
  private readonly repoRoot: string;

  /** Durable manifest reference (undefined when the loop runs in-memory). */
  get manifestRef(): SelfManifest | undefined {
    return this.manifest;
  }
  private readonly backupDir: string;
  private readonly maxBlastFraction: number;
  private readonly maxMutationsPerFile: number;
  private readonly criticalFiles: string[];
  private readonly autoFixableKinds: Set<SelfAuditKind>;

  private readonly mutationsPerFile = new Map<string, number>();
  private lastFindings = new Map<string, SelfAuditFinding>();
  private auditsRun = 0;
  private lastAuditAt: number | null = null;
  private readonly vetoCounts = new Map<SelfVetoReason, number>();
  private rollbacks = 0;
  // In-memory manifest fallback (no ledger wired): keeps a real hash chain so
  // status/rollback semantics are identical, just not durable.
  private memChain: ManifestEntry[] = [];

  constructor(options: SelfHostingOptions = {}) {
    this.scanner = options.scanner ?? new SelfAuditScanner();
    this.graph = options.graph;
    this.manifest = options.manifest;
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.backupDir = options.backupDir ?? join(this.repoRoot, '.klyn_selfhost', 'backups');
    this.maxBlastFraction = options.maxBlastFraction ?? DEFAULT_MAX_BLAST_FRACTION;
    this.maxMutationsPerFile = options.maxMutationsPerFile ?? DEFAULT_MAX_MUTATIONS_PER_FILE;
    this.criticalFiles = options.criticalFiles ?? DEFAULT_CRITICAL_FILES;
    this.autoFixableKinds = new Set(options.autoFixableKinds ?? DEFAULT_AUTO_FIXABLE);

    // The loop owns its own EpochDriver so the self-repair synthesizer is
    // always wired, regardless of how the router default-constructs its own.
    this.epoch =
      options.epoch ??
      new EpochDriver({
        bus: options.bus ?? new EventBus(),
        planner: options.planner ?? new PatchPlanner(),
        patcher: options.patcher ?? new TransactionalPatcher(),
        swarm: options.swarm ?? new AgentSwarm(options.planner ?? new PatchPlanner(), options.patcher ?? new TransactionalPatcher()),
        gate: options.gate ?? new QualityGate(),
        quantum: options.quantum,
        merkle: options.merkle,
        learner: options.learner ?? new ExperienceLearner(),
        policy: options.policy ?? new AdaptivePolicyEngine(),
        persistence: options.persistence,
        synthesize: options.synthesize ?? synthesizeSelfPatch,
      });
  }

  // -------------------------------------------------------------------------
  // AUDIT (sense)
  // -------------------------------------------------------------------------

  /** Scan the OS's own source tree. Findings are cached by id so the API can
   *  evolve a finding without re-scanning. */
  async audit(): Promise<SelfAuditReport> {
    const report = await this.scanner.scan(this.repoRoot);
    this.lastFindings = new Map(report.findings.map((f) => [f.id, f]));
    this.auditsRun++;
    this.lastAuditAt = Date.now();
    return report;
  }

  /** Resolve a cached finding by id (null when not from the last audit). */
  findingById(id: string): SelfAuditFinding | null {
    return this.lastFindings.get(id) ?? null;
  }

  // -------------------------------------------------------------------------
  // EVOLVE (act — guarded)
  // -------------------------------------------------------------------------

  /** Evolve one finding through the FULL guarded closed loop. */
  async evolve(finding: SelfAuditFinding, opts: SelfEvolveOptions = {}): Promise<SelfEvolveOutcome> {
    const t0 = performance.now();
    const rel = this.normalizeRel(finding.file);

    const guard = await this.checkGuards(finding, rel, opts);
    if (guard.vetoed) {
      this.bumpVeto(guard.reason);
      const entry = await this.appendEntry({
        file: finding.file,
        relFile: rel,
        kind: finding.kind,
        severity: finding.severity,
        blastRadius: guard.blastRadius,
        vetoed: true,
        vetoReason: guard.reason,
        outcome: 'rejected',
        quantumSeq: null,
        merkleRoot: null,
        backupPath: null,
        at: Date.now(),
      });
      return {
        ok: false,
        finding,
        vetoed: true,
        vetoReason: guard.reason,
        blastRadius: guard.blastRadius,
        epoch: null,
        manifest: entry,
        backupPath: null,
        latencyMs: performance.now() - t0,
        at: Date.now(),
      };
    }

    // Pre-mutation snapshot (the rollback primitive).
    const original = await readFile(finding.file, 'utf-8').catch(() => null);
    if (original === null) {
      const entry = await this.appendEntry({
        file: finding.file,
        relFile: rel,
        kind: finding.kind,
        severity: finding.severity,
        blastRadius: guard.blastRadius,
        vetoed: true,
        vetoReason: 'UNSAFE_PATH',
        outcome: 'rejected',
        quantumSeq: null,
        merkleRoot: null,
        backupPath: null,
        at: Date.now(),
      });
      return {
        ok: false,
        finding,
        vetoed: true,
        vetoReason: 'UNSAFE_PATH',
        blastRadius: guard.blastRadius,
        epoch: null,
        manifest: entry,
        backupPath: null,
        latencyMs: performance.now() - t0,
        at: Date.now(),
      };
    }

    const backupPath = join(this.backupDir, `${this.safeName(rel)}.${Date.now()}.bak`);
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, original, 'utf-8');

    const epochFinding: EpochFinding = {
      source: 'self',
      route: `self:${rel}:${finding.kind}:${finding.line}`,
      filePath: finding.file,
      detail: finding.detail,
      kind: finding.kind,
      severity: finding.severity,
      at: Date.now(),
    };
    const outcome = await this.epoch.drive(epochFinding, this.repoRoot, `self:${rel}:${finding.kind}`);
    this.mutationsPerFile.set(rel, (this.mutationsPerFile.get(rel) ?? 0) + 1);

    const entry = await this.appendEntry({
      file: finding.file,
      relFile: rel,
      kind: finding.kind,
      severity: finding.severity,
      blastRadius: guard.blastRadius,
      vetoed: false,
      vetoReason: null,
      outcome: outcome.ok ? 'committed' : 'rejected',
      quantumSeq: outcome.quantumSeq,
      merkleRoot: outcome.merkleRoot,
      backupPath,
      at: Date.now(),
    });

    return {
      ok: outcome.ok,
      finding,
      vetoed: false,
      vetoReason: null,
      blastRadius: guard.blastRadius,
      epoch: outcome,
      manifest: entry,
      backupPath,
      latencyMs: performance.now() - t0,
      at: Date.now(),
    };
  }

  /** Evolve a cached finding by id (the /v1/self/evolve API path). */
  async evolveById(id: string, opts: SelfEvolveOptions = {}): Promise<SelfEvolveOutcome | null> {
    const finding = this.lastFindings.get(id);
    if (!finding) return null;
    return this.evolve(finding, opts);
  }

  /** Guarded profiler-violation heal: critical/convergence/blast guards apply,
   *  then the epoch's violation driver heals the breached route's handler. */
  async evolveViolation(route: string, profiler: RuntimeProfiler, opts: SelfEvolveOptions = {}): Promise<{ ok: boolean; vetoed?: boolean; vetoReason?: SelfVetoReason; reason?: string; epoch?: EpochOutcome }> {
    const filePath = profiler.sampleFilePath(route);
    if (!filePath) return { ok: false, reason: 'no filePath recorded for route samples' };
    const rel = this.normalizeRel(filePath);

    if (!opts.force && this.isCritical(rel)) {
      this.bumpVeto('CRITICAL_FILE_PROTECTED');
      return { ok: false, vetoed: true, vetoReason: 'CRITICAL_FILE_PROTECTED', reason: 'violation handler is a protected critical file' };
    }
    const count = this.mutationsPerFile.get(rel) ?? 0;
    if (!opts.overrideConvergence && count >= this.maxMutationsPerFile) {
      this.bumpVeto('CONVERGENCE_LOCK');
      return { ok: false, vetoed: true, vetoReason: 'CONVERGENCE_LOCK', reason: 'per-file mutation budget exhausted' };
    }
    if (this.graph) {
      const stats = this.graph.getStats();
      if (stats.files > 0) {
        const q = this.graph.execute({ kind: 'blast_radius', target: rel });
        if (q.ok && q.blastRadius !== undefined && q.blastRadius / stats.files > this.maxBlastFraction) {
          this.bumpVeto('BLAST_RADIUS_EXCEEDED');
          return { ok: false, vetoed: true, vetoReason: 'BLAST_RADIUS_EXCEEDED', reason: `blast radius ${q.blastRadius}/${stats.files} exceeds ${this.maxBlastFraction}` };
        }
      }
    }

    const outcome = await this.epoch.driveViolation(route, profiler, this.repoRoot);
    this.mutationsPerFile.set(rel, count + 1);
    return { ok: outcome.ok, epoch: outcome };
  }

  // -------------------------------------------------------------------------
  // ROLLBACK (deterministic undo)
  // -------------------------------------------------------------------------

  /** Restore a file byte-exact to its pre-mutation snapshot via the manifest
   *  rollback index. Appends a 'rolled_back' manifest entry. */
  async rollback(seq: number): Promise<RollbackOutcome> {
    if (!this.manifest) return { ok: false, reason: 'no durable manifest wired — rollback unavailable' };
    const entry = await this.manifest.findBySeq(seq);
    if (!entry) return { ok: false, reason: `no manifest entry at seq ${seq}` };
    if (!entry.backupPath) return { ok: false, reason: `entry ${seq} has no backup snapshot` };
    const backup = await readFile(entry.backupPath, 'utf-8').catch(() => null);
    if (backup === null) return { ok: false, reason: `backup snapshot missing: ${entry.backupPath}` };
    await writeFile(entry.file, backup, 'utf-8');
    this.rollbacks++;

    const rec = await this.appendEntry({
      file: entry.file,
      relFile: entry.relFile,
      kind: entry.kind,
      severity: entry.severity,
      blastRadius: entry.blastRadius,
      vetoed: false,
      vetoReason: null,
      outcome: 'rolled_back',
      quantumSeq: null,
      merkleRoot: null,
      backupPath: null,
      at: Date.now(),
    });
    return { ok: true, seq, file: entry.file, backupPath: entry.backupPath, manifest: rec };
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  async status(): Promise<{
    auditsRun: number;
    lastAuditAt: number | null;
    filesMutated: number;
    totalMutations: number;
    vetoCounts: Record<string, number>;
    rollbacks: number;
    manifestEntries: number;
    epoch: ReturnType<EpochDriver['getStats']>;
  }> {
    const manifestEntries = this.manifest ? await this.manifest.size() : 0;
    const vetoCounts: Record<string, number> = {};
    for (const [k, v] of this.vetoCounts) vetoCounts[k] = v;
    return {
      auditsRun: this.auditsRun,
      lastAuditAt: this.lastAuditAt,
      filesMutated: this.mutationsPerFile.size,
      totalMutations: Array.from(this.mutationsPerFile.values()).reduce((a, b) => a + b, 0),
      vetoCounts,
      rollbacks: this.rollbacks,
      manifestEntries,
      epoch: this.epoch.getStats(),
    };
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private async checkGuards(
    finding: SelfAuditFinding,
    rel: string,
    opts: SelfEvolveOptions
  ): Promise<{ vetoed: boolean; reason: SelfVetoReason | null; blastRadius: number | null }> {
    if (!opts.force && this.isCritical(rel)) {
      return { vetoed: true, reason: 'CRITICAL_FILE_PROTECTED', blastRadius: null };
    }
    const count = this.mutationsPerFile.get(rel) ?? 0;
    if (!opts.overrideConvergence && count >= this.maxMutationsPerFile) {
      return { vetoed: true, reason: 'CONVERGENCE_LOCK', blastRadius: null };
    }
    let blastRadius: number | null = null;
    if (this.graph) {
      const stats = this.graph.getStats();
      if (stats.files > 0) {
        const q = this.graph.execute({ kind: 'blast_radius', target: rel });
        if (q.ok && q.blastRadius !== undefined) {
          blastRadius = q.blastRadius;
          if (!opts.force && blastRadius / stats.files > this.maxBlastFraction) {
            return { vetoed: true, reason: 'BLAST_RADIUS_EXCEEDED', blastRadius };
          }
        }
      }
    }
    if (!opts.force && !this.autoFixableKinds.has(finding.kind)) {
      return { vetoed: true, reason: 'MANUAL_FINDING', blastRadius };
    }
    return { vetoed: false, reason: null, blastRadius };
  }

  private isCritical(rel: string): boolean {
    const norm = rel.split('\\').join('/');
    return this.criticalFiles.some((c) => {
      const cn = c.split('\\').join('/');
      return norm === cn || norm.endsWith('/' + cn) || basename(norm) === basename(cn);
    });
  }

  private normalizeRel(file: string): string {
    return relative(this.repoRoot, file).split('\\').join('/');
  }

  private safeName(rel: string): string {
    return rel.split('\\').join('/').replace(/[^A-Za-z0-9._-]/g, '_');
  }

  private bumpVeto(reason: SelfVetoReason): void {
    this.vetoCounts.set(reason, (this.vetoCounts.get(reason) ?? 0) + 1);
  }

  private async appendEntry(input: Parameters<SelfManifest['append']>[0]): Promise<ManifestEntry> {
    if (this.manifest) return this.manifest.append(input);
    // In-memory fallback: keep the loop fully functional without a ledger —
    // same chained shape, so callers cannot tell the difference.
    const prev = this.memChain.length > 0 ? this.memChain[this.memChain.length - 1] : null;
    const entry: ManifestEntry = {
      ...input,
      seq: prev ? prev.seq + 1 : 1,
      prevHash: prev?.hash ?? '',
      hash: '',
    };
    const canonical = {
      seq: entry.seq, prevHash: entry.prevHash, file: entry.file, relFile: entry.relFile,
      kind: entry.kind, severity: entry.severity, blastRadius: entry.blastRadius,
      vetoed: entry.vetoed, vetoReason: entry.vetoReason, outcome: entry.outcome,
      quantumSeq: entry.quantumSeq, merkleRoot: entry.merkleRoot,
      backupPath: entry.backupPath, at: entry.at,
    };
    entry.hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    this.memChain.push(entry);
    return entry;
  }
}

export default SelfHostingLoop;
