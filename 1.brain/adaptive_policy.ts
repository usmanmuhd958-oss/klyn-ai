// =============================================================================
// KLYN AI OS — 1.brain — Adaptive Policy Engine (Phase 7)
// File: 1.brain/adaptive_policy.ts
//
// Phase 7 capability #2. The steering half of the closed learning loop. The
// OS's behavioral knobs — cascade escalation threshold, quality-gate
// strictness, red-team fuzz cadence, repair-loop budget, retry budget, fleet
// load threshold — are managed as VERSIONED, Merkle-SIGNED policy snapshots:
//
//   policy.proposeFromLearner(learner)   — synthesize a candidate from learned
//                                          operational stats (deterministic)
//   policy.activate(draft)               — activate with a regression guard:
//                                          baseline health is frozen, the
//                                          candidate is observed for a window,
//                                          and a measured regression triggers
//                                          deterministic rollback
//   policy.observe(success, latencyMs?)  — feed outcome telemetry
//   policy.rollback()                    — restore the previous snapshot
//   policy.auditDraft(draft)             — tamper detection (recompute the
//                                          canonical rules hash vs the ledger)
//   policy.verifyLedger()                — full Merkle replay verification
//
// Every snapshot is committed to the Phase 4 Merkle ledger, so the policy
// history is cryptographically tamper-evident and the active policy can be
// proven at any instant. A policy can only ever be *improved on evidence* —
// never changed by accident, and never left regressed.
// =============================================================================
import MerkleAudit, { sha256 } from '../kernel/src/security/merkle_audit.js';
import type { ExperienceLearner } from './experience_learner.js';

export interface PolicyRules {
  /** 0..1 — route confidence below which the cascade router escalates to a
   *  heavy reasoning model (lower = escalate earlier/more often). */
  cascadeHeavyThreshold: number;
  /** 0..1 — quality-gate strictness multiplier for the mutation harness. */
  qualityGateStrict: number;
  /** ms between red-team fuzz passes (lower = fuzz more aggressively). */
  fuzzerIntervalMs: number;
  /** Max self-healing mutation-loop iterations before deterministic rollback. */
  maxRepairIterations: number;
  /** Exponential-backoff retry budget for LLM/DB/API pipelines. */
  retryBudget: number;
  /** Pending ops per fleet node before the orchestrator quarantines it. */
  fleetLoadThreshold: number;
}

export interface PolicySnapshot {
  version: number;
  rules: PolicyRules;
  rationale: string[];
  createdAt: number;
  /** Merkle root BEFORE this snapshot — chains the policy history. */
  prevRoot: string | null;
  /** Merkle root AFTER this snapshot was committed. */
  root: string;
}

export interface ActivateResult {
  ok: boolean;
  reason: string;
  version: number;
  root: string | null;
}

export interface ObserveResult {
  evaluated: boolean;
  stable: boolean;
  rolledBack: boolean;
  version: number;
  baselineSuccessRate: number;
  currentSuccessRate: number;
}

export interface RollbackResult {
  ok: boolean;
  fromVersion: number;
  toVersion: number;
  reason: string;
}

export interface PolicyEngineOptions {
  /** Baseline rules seeded as version 0 (defaults are the v0 baseline). */
  baseline?: PolicyRules;
  /** Merkle ledger backing the policy history (default: fresh ledger). */
  merkle?: MerkleAudit;
  /** Outcome window for regression evaluation (default 32). */
  windowSize?: number;
  /** Success-rate regression tolerance (default 0.15 — a drop larger than
   *  15 points below baseline triggers rollback). */
  tolerance?: number;
}

export const DEFAULT_POLICY_RULES: PolicyRules = {
  cascadeHeavyThreshold: 0.5,
  qualityGateStrict: 0.5,
  fuzzerIntervalMs: 30_000,
  maxRepairIterations: 3,
  retryBudget: 3,
  fleetLoadThreshold: 8,
};

const DEFAULT_WINDOW_SIZE = 32;
const DEFAULT_TOLERANCE = 0.15;
const MIN_SAMPLES_TO_PROPOSE = 8;

/** Exact bounded deque of recent outcomes — the rolling health baseline. */
interface OutcomeWindow {
  successes: boolean[];
  latencies: number[];
  readonly cap: number;
}

function windowPush(w: OutcomeWindow, success: boolean, latencyMs: number): void {
  w.successes.push(success);
  w.latencies.push(latencyMs);
  if (w.successes.length > w.cap) {
    w.successes.shift();
    w.latencies.shift();
  }
}

function windowRate(w: OutcomeWindow): number {
  if (w.successes.length === 0) return 1;
  let ok = 0;
  for (const s of w.successes) if (s) ok++;
  return ok / w.successes.length;
}

function windowAvgLatency(w: OutcomeWindow): number {
  if (w.latencies.length === 0) return 0;
  let sum = 0;
  for (const l of w.latencies) sum += l;
  return sum / w.latencies.length;
}

export class AdaptivePolicyEngine {
  private merkle: MerkleAudit;
  private snapshots: PolicySnapshot[] = [];
  private activeIndex = 0;
  private readonly windowSize: number;
  private readonly tolerance: number;

  // Rolling outcome window (exact bounded deque) — the pre-activation health
  // baseline.
  private window: OutcomeWindow;
  // Post-activation tracking window.
  private pendingEvaluation = false;
  private obsSinceActivation = 0;
  private activationWindow: OutcomeWindow;
  private baselineAtActivation: { successRate: number; avgLatencyMs: number } | null = null;

  constructor(options: PolicyEngineOptions = {}) {
    this.merkle = options.merkle ?? new MerkleAudit();
    this.windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
    this.tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    this.window = { successes: [], latencies: [], cap: this.windowSize };
    this.activationWindow = { successes: [], latencies: [], cap: this.windowSize };
    const baseline = sanitizeRules(options.baseline ?? DEFAULT_POLICY_RULES);
    // Commit the RULES OBJECT (not a pre-stringified value) so the ledger
    // leaf hash equals sha256(canonicalRules) — auditDraft recomputes exactly
    // that string from the in-memory rules and compares against the signed
    // hash, which is what makes tamper detection exact.
    const committed = this.merkle.commitState('policy:v0', baseline, { baseline: true, rationale: ['factory baseline'] });
    this.snapshots.push({
      version: 0,
      rules: { ...baseline },
      rationale: ['factory baseline'],
      createdAt: Date.now(),
      prevRoot: null,
      root: committed.root,
    });
  }

  // -------------------------------------------------------------------------
  // ACTIVE POLICY
  // -------------------------------------------------------------------------

  get active(): PolicySnapshot {
    return { ...this.snapshots[this.activeIndex], rules: { ...this.snapshots[this.activeIndex].rules } };
  }

  get activeVersion(): number {
    return this.snapshots[this.activeIndex].version;
  }

  /** Read-only snapshot of the full policy history (newest last). */
  history(): PolicySnapshot[] {
    return this.snapshots.map((s) => ({ ...s, rules: { ...s.rules } }));
  }

  /** Full Merkle replay verification of the ledger backing these policies. */
  verifyLedger(): boolean {
    return this.merkle.verifyLedger();
  }

  /** Tamper detection: recompute the canonical rules hash of a draft and
   *  compare against the ledger entry committed for that version. A mismatch
   *  means the draft diverged from what was cryptographically signed. */
  auditDraft(draft: PolicySnapshot): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const ref = `policy:v${draft.version}`;
    const entry = this.merkle
      .entries()
      .filter((e) => e.ref === ref)
      .pop();
    if (!entry) {
      reasons.push(`no ledger entry for ${ref}`);
      return { ok: false, reasons };
    }
    const canonical = this.canonicalRules(draft.rules);
    if (entry.hash !== sha256(canonical)) {
      reasons.push(`rules hash diverged from signed ledger (draft=${canonical.slice(0, 12)}… signed=${entry.hash.slice(0, 12)}…)`);
    }
    if (draft.root !== entry.root) {
      reasons.push(`draft root ${draft.root.slice(0, 12)}… does not match signed root ${entry.root.slice(0, 12)}…`);
    }
    return { ok: reasons.length === 0, reasons };
  }

  // -------------------------------------------------------------------------
  // PROPOSAL (deterministic — pure function of learner stats + active rules)
  // -------------------------------------------------------------------------

  /** Synthesize a candidate policy snapshot from learned operational stats.
   *  Deterministic: identical learner state always yields identical rules. */
  proposeFromLearner(learner: ExperienceLearner): PolicySnapshot {
    const rules: PolicyRules = { ...this.active.rules };
    const rationale: string[] = [];
    const nextVersion = this.snapshots[this.snapshots.length - 1].version + 1;

    const patch = learner.query('patch');
    if (patch && patch.samples >= MIN_SAMPLES_TO_PROPOSE) {
      if (patch.successRate < 0.85) {
        rules.qualityGateStrict = clamp01(rules.qualityGateStrict + 0.2);
        rules.maxRepairIterations = clamp(rules.maxRepairIterations - 1, 1, 10);
        rationale.push(
          `patch success ${(patch.successRate * 100).toFixed(0)}% < 85% → tighten gate to ${rules.qualityGateStrict.toFixed(2)}, repair budget ${rules.maxRepairIterations}`
        );
      } else if (patch.successRate >= 0.95) {
        rules.qualityGateStrict = clamp01(rules.qualityGateStrict - 0.1);
        rationale.push(`patch success ${(patch.successRate * 100).toFixed(0)}% ≥ 95% → relax gate to ${rules.qualityGateStrict.toFixed(2)}`);
      }
    }

    const routes = learner.query('route');
    if (routes && routes.samples >= MIN_SAMPLES_TO_PROPOSE) {
      if (routes.successRate < 0.9) {
        rules.cascadeHeavyThreshold = clamp01(rules.cascadeHeavyThreshold + 0.1);
        rationale.push(`route success ${(routes.successRate * 100).toFixed(0)}% < 90% → escalate earlier (threshold ${rules.cascadeHeavyThreshold.toFixed(2)})`);
      } else if (routes.successRate >= 0.98) {
        rules.cascadeHeavyThreshold = clamp01(rules.cascadeHeavyThreshold - 0.05);
        rationale.push(`route success ${(routes.successRate * 100).toFixed(0)}% ≥ 98% → escalate later (threshold ${rules.cascadeHeavyThreshold.toFixed(2)})`);
      }
    }

    const fuzz = learner.query('fuzz');
    if (fuzz && fuzz.samples >= MIN_SAMPLES_TO_PROPOSE) {
      if (fuzz.failures > 0) {
        rules.fuzzerIntervalMs = clamp(rules.fuzzerIntervalMs - 5_000, 5_000, 60_000);
        rationale.push(`${fuzz.failures} fuzz finding(s) → fuzz more often (${rules.fuzzerIntervalMs}ms)`);
      } else {
        rules.fuzzerIntervalMs = clamp(rules.fuzzerIntervalMs + 5_000, 5_000, 60_000);
        rationale.push('no fuzz findings → back off cadence');
      }
    }

    const fleet = learner.query('fleet');
    if (fleet && fleet.samples >= MIN_SAMPLES_TO_PROPOSE) {
      if (fleet.failures > 0) {
        rules.fleetLoadThreshold = clamp(rules.fleetLoadThreshold + 2, 2, 64);
        rationale.push(`${fleet.failures} fleet error(s) → raise load threshold to ${rules.fleetLoadThreshold}`);
      }
    }

    return {
      version: nextVersion,
      rules,
      rationale,
      createdAt: Date.now(),
      prevRoot: null,
      root: '',
    };
  }

  // -------------------------------------------------------------------------
  // ACTIVATION (regression-guarded) + OUTCOME FEEDING
  // -------------------------------------------------------------------------

  /** Activate a proposed snapshot. The current rolling health is frozen as the
   *  baseline; the candidate takes effect immediately and is then observed for
   *  `windowSize` outcomes — a measured regression rolls it back. */
  activate(draft: PolicySnapshot, baseline?: { successRate?: number; avgLatencyMs?: number }): ActivateResult {
    const sanitized = sanitizeRules(draft.rules);
    if (canonicalEqual(sanitized, this.active.rules)) {
      return { ok: false, reason: 'candidate identical to active policy (no-op)', version: this.activeVersion, root: this.active.root };
    }
    if (draft.version !== this.snapshots[this.snapshots.length - 1].version + 1) {
      return { ok: false, reason: `version mismatch: expected ${this.snapshots[this.snapshots.length - 1].version + 1}, got ${draft.version}`, version: draft.version, root: null };
    }

    const prev = this.snapshots[this.activeIndex];
    const committed = this.merkle.commitState(`policy:v${draft.version}`, sanitized, {
      rationale: draft.rationale,
      prevRoot: prev.root,
    });

    const snapshot: PolicySnapshot = {
      version: draft.version,
      rules: sanitized,
      rationale: [...draft.rationale],
      createdAt: Date.now(),
      prevRoot: prev.root,
      root: committed.root,
    };
    this.snapshots.push(snapshot);
    this.activeIndex = this.snapshots.length - 1;

    // Freeze the baseline and open the evaluation window.
    const baselineRate = baseline?.successRate ?? windowRate(this.window);
    const baselineLatency = baseline?.avgLatencyMs ?? windowAvgLatency(this.window);
    this.baselineAtActivation = { successRate: baselineRate, avgLatencyMs: baselineLatency };
    this.pendingEvaluation = true;
    this.obsSinceActivation = 0;
    this.activationWindow = { successes: [], latencies: [], cap: this.windowSize };

    return { ok: true, reason: 'activated', version: snapshot.version, root: snapshot.root };
  }

  /** Feed one outcome (typically a 'patch' scope result). When the post-
   *  activation window fills, the candidate is evaluated against the frozen
   *  baseline and rolled back deterministically on regression. */
  observe(success: boolean, latencyMs?: number): ObserveResult {
    const latency = typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;

    // Rolling baseline window (exact bounded deque).
    windowPush(this.window, success, latency);

    if (!this.pendingEvaluation) {
      return { evaluated: false, stable: true, rolledBack: false, version: this.activeVersion, baselineSuccessRate: 0, currentSuccessRate: 0 };
    }

    this.obsSinceActivation++;
    windowPush(this.activationWindow, success, latency);

    if (this.obsSinceActivation < this.windowSize) {
      return { evaluated: false, stable: true, rolledBack: false, version: this.activeVersion, baselineSuccessRate: 0, currentSuccessRate: 0 };
    }

    // Window full — evaluate.
    const baseline = this.baselineAtActivation ?? { successRate: 1, avgLatencyMs: 0 };
    const currentRate = windowRate(this.activationWindow);
    const currentLatency = windowAvgLatency(this.activationWindow);
    this.pendingEvaluation = false;

    const regressedRate = currentRate < baseline.successRate - this.tolerance;
    const regressedLatency = baseline.avgLatencyMs > 0 && currentLatency > baseline.avgLatencyMs * 1.5;
    if (regressedRate || regressedLatency) {
      const reason = regressedRate
        ? `success rate ${(currentRate * 100).toFixed(0)}% fell below baseline ${(baseline.successRate * 100).toFixed(0)}% − ${this.tolerance}`
        : `avg latency ${currentLatency.toFixed(0)}ms exceeded ${baseline.avgLatencyMs.toFixed(0)}ms baseline`;
      const rollback = this.rollback(reason);
      return {
        evaluated: true,
        stable: false,
        rolledBack: rollback.ok,
        version: this.activeVersion,
        baselineSuccessRate: baseline.successRate,
        currentSuccessRate: currentRate,
      };
    }

    return {
      evaluated: true,
      stable: true,
      rolledBack: false,
      version: this.activeVersion,
      baselineSuccessRate: baseline.successRate,
      currentSuccessRate: currentRate,
    };
  }

  /** Restore the previous snapshot. Merkle-recorded — the rollback itself is
   *  part of the tamper-evident history. */
  rollback(reason = 'manual'): RollbackResult {
    if (this.activeIndex === 0) {
      return { ok: false, fromVersion: this.activeVersion, toVersion: this.activeVersion, reason: 'no previous version' };
    }
    const from = this.activeVersion;
    this.activeIndex--;
    this.pendingEvaluation = false;
    this.merkle.commitEvent('policy:rollback', { fromVersion: from, toVersion: this.activeVersion, reason });
    return { ok: true, fromVersion: from, toVersion: this.activeVersion, reason };
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private canonicalRules(rules: PolicyRules): string {
    return JSON.stringify(sanitizeRules(rules));
  }
}

// -----------------------------------------------------------------------------
// RULE SANITIZATION (deterministic clamps — a policy can never carry garbage)
// -----------------------------------------------------------------------------

export function sanitizeRules(rules: PolicyRules): PolicyRules {
  return {
    cascadeHeavyThreshold: clamp01(rules.cascadeHeavyThreshold),
    qualityGateStrict: clamp01(rules.qualityGateStrict),
    fuzzerIntervalMs: clamp(rules.fuzzerIntervalMs, 5_000, 60_000),
    maxRepairIterations: clamp(Math.round(rules.maxRepairIterations), 1, 10),
    retryBudget: clamp(Math.round(rules.retryBudget), 0, 10),
    fleetLoadThreshold: clamp(Math.round(rules.fleetLoadThreshold), 2, 64),
  };
}

function canonicalEqual(a: PolicyRules, b: PolicyRules): boolean {
  return JSON.stringify(sanitizeRules(a)) === JSON.stringify(sanitizeRules(b));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export default AdaptivePolicyEngine;
