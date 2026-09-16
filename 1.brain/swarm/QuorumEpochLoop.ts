// =============================================================================
// KLYN AI OS — 1.brain — Quorum-Gated Swarm Epoch Loop (Phase 13)
// File: 1.brain/swarm/QuorumEpochLoop.ts
//
// Phase 13 capability #1. Fuses the Phase 9 multi-agent swarm epoch
// (Architect · CodeModder · SecurityAuditor · TestGenerator) with the
// Phase 12 BFT consensus engine into ONE hard gate: NO code mutation may
// reach finality (post-quantum + Merkle signed commit) without a strict
// majority quorum of federated peers voting for it:
//
//   finding → swarm epoch (4 agents vote) → WOTS+/ZK signed proposal
//            → BFT quorum (ConsensusIsolation, f < n/2 Byzantine-safe)
//            → [committed] quantum + Merkle finalize
//            → [rejected]  byte-exact rollback, rogue agent quarantined
//
// The quorum gate is the FINALITY boundary, not just a review step: if the
// federated peers do not approve, the loop deterministically restores the
// pre-epoch bytes (rollback), so the tree is never left altered without a
// signed quorum, and no Phase 4 Merkle / Phase 8 post-quantum audit entry is
// ever created for an unapproved mutation.
//
// Byzantine agent isolation: if the proposal fails cryptographic
// verification (tampered WOTS+ signature or rebound ZK proof — the signature
// of a rogue agent mid-commit), the proposing agent is QUARANTINED in the
// consensus engine immediately, before the epoch can be retried.
//
// Fail-closed: with zero federated voters the loop refuses to commit — an
// unfederated cluster cannot mutate code through this gate.
//
//   const loop = new QuorumEpochLoop({ consensus, voters, quantum, merkle, learner, policy, gate, swarm });
//   const outcome = await loop.drive(finding, repoRoot);
// =============================================================================
import { readFile, writeFile } from 'node:fs/promises';

import { AgentSwarm, type SwarmVote } from './AgentSwarm.js';
import { PatchPlanner } from '../patch_planner.js';
import { TransactionalPatcher } from '../../2.body/transactional_patcher.js';
import { QualityGate } from '../../packages/self-healing-runtime/src/mutation_harness.js';
import { QuantumZkLedger } from '../../kernel/src/security/quantum_zk.js';
import MerkleAudit from '../../kernel/src/security/merkle_audit.js';
import { ExperienceLearner, type ExperienceStats } from '../experience_learner.js';
import { AdaptivePolicyEngine } from '../adaptive_policy.js';
import { ConsensusIsolation, type ConsensusResult, type ConsensusProposal } from '../consensus_isolation.js';
import { synthesizeDefensivePatch, type EpochFinding } from '../e2e_autonomous_epoch.js';
import type { FileOperation } from '../patch_generator.js';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export interface QuorumEpochOptions {
  /** The BFT consensus engine that owns signatures, votes, and quarantine. */
  consensus: ConsensusIsolation;
  /** Federated peers allowed to vote (resolve from the mesh at drive time).
   *  Empty = fail-closed: the epoch cannot commit. */
  voters: string[];
  /** Simulated Byzantine voters for fault-injection tests. */
  malicious?: string[];
  /** Proposer signing secret (per-agent identity). */
  secret?: string;
  swarm?: AgentSwarm;
  patcher?: TransactionalPatcher;
  gate?: QualityGate;
  quantum?: QuantumZkLedger;
  merkle?: MerkleAudit;
  learner?: ExperienceLearner;
  policy?: AdaptivePolicyEngine;
  /** Candidate synthesizer (default: the Phase 9 defensive patch). */
  synthesize?: (original: string, finding: EpochFinding) => string;
  /** TEST SEAM: simulate a rogue agent corrupting the proposal between
   *  signing and verification (Byzantine injection). */
  tamper?: (proposal: ConsensusProposal) => ConsensusProposal;
  requireTester?: boolean;
}

export interface QuorumEpochOutcome {
  ok: boolean;
  finding: EpochFinding;
  swarmVotes: SwarmVote[];
  swarmCommitted: boolean;
  quorum: ConsensusResult;
  committed: boolean;
  filesWritten: string[];
  finalContent: string | null;
  /** Phase 8 post-quantum seq of the signed commit (null when unwired or
   *  when the quorum rejected the epoch). */
  quantumSeq: number | null;
  merkleRoot: string | null;
  learnerStats: ExperienceStats | null;
  policyVersion: number;
  /** True when the quorum rejected the epoch and the file was restored
   *  byte-exact — the tree was never left altered without a signed quorum. */
  rolledBack: boolean;
  /** Proposing agent quarantined mid-epoch (invalid ZK/WOTS proof). */
  quarantined: string | null;
  errors: string[];
  latencyMs: number;
  at: number;
}

export interface QuorumEpochStats {
  drives: number;
  committed: number;
  rejected: number;
  rolledBack: number;
  quarantined: string[];
  quorumSize: number;
}

// -----------------------------------------------------------------------------
// THE QUORUM-GATED LOOP
// -----------------------------------------------------------------------------

export class QuorumEpochLoop {
  private readonly consensus: ConsensusIsolation;
  private readonly voters: string[];
  private readonly malicious: string[];
  private readonly secret: string;
  private readonly swarm: AgentSwarm;
  private readonly gate: QualityGate;
  private readonly quantum?: QuantumZkLedger;
  private readonly merkle?: MerkleAudit;
  private readonly learner: ExperienceLearner;
  private readonly policy: AdaptivePolicyEngine;
  private readonly synthesize: (original: string, finding: EpochFinding) => string;
  private readonly tamper?: (proposal: ConsensusProposal) => ConsensusProposal;
  private readonly requireTester: boolean;
  private drives = 0;
  private committed = 0;
  private rejected = 0;
  private rolledBack = 0;

  constructor(options: QuorumEpochOptions) {
    this.consensus = options.consensus;
    this.voters = options.voters;
    this.malicious = options.malicious ?? [];
    this.secret = options.secret ?? 'klyn-quorum-epoch-secret';
    this.swarm = options.swarm ?? new AgentSwarm(new PatchPlanner(), options.patcher ?? new TransactionalPatcher());
    this.gate = options.gate ?? new QualityGate();
    this.quantum = options.quantum;
    this.merkle = options.merkle;
    this.learner = options.learner ?? new ExperienceLearner();
    this.policy = options.policy ?? new AdaptivePolicyEngine();
    this.synthesize = options.synthesize ?? synthesizeDefensivePatch;
    this.tamper = options.tamper;
    this.requireTester = options.requireTester ?? true;
  }

  /**
   * Drive ONE quorum-gated epoch. The swarm evaluates the mutation first;
   * finality (post-quantum + Merkle signing) happens ONLY after the BFT
   * quorum approves. On rejection the pre-epoch bytes are restored exactly.
   */
  async drive(finding: EpochFinding, repoRoot: string = process.cwd()): Promise<QuorumEpochOutcome> {
    const t0 = performance.now();
    const at = Date.now();
    const errors: string[] = [];
    const ref = finding.filePath;
    const outcome: QuorumEpochOutcome = {
      ok: false,
      finding,
      swarmVotes: [],
      swarmCommitted: false,
      quorum: {
        proposalId: '',
        kind: 'patch',
        ref,
        outputHash: '',
        approvals: 0,
        rejections: 0,
        quorum: this.consensus.quorum,
        committed: false,
        committedBy: [],
        rejectedBy: [],
        at,
      },
      committed: false,
      filesWritten: [],
      finalContent: null,
      quantumSeq: null,
      merkleRoot: null,
      learnerStats: null,
      policyVersion: this.policy.activeVersion,
      rolledBack: false,
      quarantined: null,
      errors,
      latencyMs: 0,
      at,
    };
    this.drives++;

    // 1) Read the target — a vanished handler aborts before anything moves.
    const original = await readFile(ref, 'utf-8').catch(() => null);
    if (original === null) {
      errors.push(`handler file unreadable: ${ref}`);
      return this.finish(outcome, t0, false);
    }

    // 2) Synthesize + fail-fast quality gate (no swarm, no quorum).
    const candidate = this.synthesize(original, finding);
    if (candidate.length === 0 || candidate === original) {
      errors.push('synthesizer produced no change');
      return this.finish(outcome, t0, false);
    }
    const preGate = this.gate.evaluate({ code: candidate });
    if (!preGate.approved) {
      errors.push(`quality gate rejected candidate: ${preGate.reasons.join('; ')}`);
      return this.finish(outcome, t0, false);
    }

    // 3) Multi-agent swarm epoch (four agents vote; writes only on commit).
    const op: FileOperation = { type: 'modify', path: ref, oldContent: original, newContent: candidate };
    const epoch = await this.swarm.runEpochOps([op], `${finding.source}:${finding.kind} on ${finding.route}`, { repoRoot, requireTester: this.requireTester });
    outcome.swarmVotes = epoch.votes;
    outcome.swarmCommitted = epoch.committed;
    outcome.filesWritten = epoch.filesWritten;
    if (!epoch.committed) {
      errors.push(...(epoch.errors.length > 0 ? epoch.errors : ['swarm consensus rejected the epoch']));
      return this.finish(outcome, t0, false);
    }

    // 4) BFT quorum gate — the FINALITY boundary. The proposal binds the
    //    exact original → final transition; a strict majority of federated
    //    peers must verify its WOTS+/ZK proof and approve it.
    const final = await readFile(ref, 'utf-8').catch(() => null);
    const applied = final ?? candidate;
    outcome.finalContent = applied;
    const { proposal, result } = await this.consensus.runQuorum(
      { proposer: finding.source === 'self' ? `${finding.source}:${finding.kind}` : 'klyn-epoch', kind: 'patch', ref, input: original, output: applied, meta: { source: finding.source, route: finding.route, kind: finding.kind } },
      this.voters,
      this.malicious,
      this.secret
    );
    const gated = this.tamper ? this.tamper(proposal) : proposal;
    outcome.quorum = result;

    // 5) Byzantine agent isolation: an invalid proof mid-commit means the
    //    proposing agent is rogue — quarantine it before anything else.
    const verified = this.consensus.verify(gated);
    if (!verified.ok) {
      outcome.quarantined = gated.proposer;
      this.consensus.quarantine(gated.proposer, 'invalid ZK/WOTS proof during quorum-gated epoch');
      errors.push(`byzantine agent quarantined: ${verified.reasons.join('; ')}`);
      await this.rollbackTo(ref, original);
      outcome.rolledBack = true;
      return this.finish(outcome, t0, false);
    }

    if (!result.committed) {
      errors.push(`BFT quorum rejected the epoch (${result.approvals}/${result.quorum} approvals)`);
      await this.rollbackTo(ref, original);
      outcome.rolledBack = true;
      return this.finish(outcome, t0, false);
    }

    // 6) FINALITY — only a quorum-approved mutation is signed into the
    //    post-quantum ledger and the Phase 4 Merkle audit.
    if (this.quantum) {
      const record = this.quantum.commitMutation('patch', ref, original, applied, {
        source: finding.source,
        route: finding.route,
        kind: finding.kind,
        gate: 'quorum',
      });
      outcome.quantumSeq = record.seq;
    }
    if (this.merkle) {
      outcome.merkleRoot = this.merkle.commitFile(ref, applied, { source: finding.source, route: finding.route, kind: finding.kind, at }).root;
    }
    this.learner.record('patch', ref, true, performance.now() - t0, `${finding.source}:${finding.kind} healed via quorum`);
    outcome.learnerStats = this.learner.query('patch');
    this.policy.observe(true, performance.now() - t0);
    outcome.policyVersion = this.policy.activeVersion;
    this.committed++;

    outcome.ok = true;
    outcome.committed = true;
    return this.finish(outcome, t0, true);
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY + QUARANTINE DELEGATION
  // -------------------------------------------------------------------------

  getStats(): QuorumEpochStats {
    return {
      drives: this.drives,
      committed: this.committed,
      rejected: this.rejected,
      rolledBack: this.rolledBack,
      quarantined: this.consensus.getStats().quarantined,
      quorumSize: this.consensus.quorum,
    };
  }

  isQuarantined(nodeId: string): boolean {
    return this.consensus.isQuarantined(nodeId);
  }

  quarantined(): string[] {
    return this.consensus.getStats().quarantined;
  }

  admit(nodeId: string): void {
    this.consensus.admit(nodeId);
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private async rollbackTo(ref: string, original: string): Promise<void> {
    await writeFile(ref, original, 'utf-8').catch(() => {});
    this.rolledBack++;
  }

  private finish(outcome: QuorumEpochOutcome, t0: number, committed: boolean): QuorumEpochOutcome {
    if (!committed && !outcome.committed) this.rejected++;
    outcome.latencyMs = performance.now() - t0;
    return outcome;
  }
}

export default QuorumEpochLoop;
