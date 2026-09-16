// =============================================================================
// KLYN AI OS — 1.brain — Lock-Free Consensus Isolation Engine (Phase 12)
// File: 1.brain/consensus_isolation.ts
//
// Phase 12 capability #2. A lightweight Byzantine Fault Tolerant (BFT)
// consensus loop for cross-node AST patches and policy updates. The engine
// is LOCK-FREE by construction: proposals, votes, and results are immutable
// records in plain maps — no mutexes, no critical sections, no coordinator.
// Every decision is a pure function of the records already present, so
// concurrent proposers/voters can never deadlock or corrupt each other.
//
// A mutation can ONLY be committed when BOTH hold:
//   1. CRYPTOGRAPHIC VERIFICATION — the proposal carries a WOTS+ signature
//      (post-quantum, from quantum_zk.ts) over its canonical payload AND a
//      Fiat-Shamir ZK knowledge proof (statement bound to the proposal id).
//      Every honest voter re-verifies both before its vote counts — a
//      malicious or corrupted replica cannot inject an unverified mutation.
//   2. MAJORITY QUORUM — approvals must exceed quorumSize / 2. With an
//      honest majority this is BFT-safe: f < n/2 Byzantine voters can never
//      block a valid proposal or commit an invalid one.
//
// Isolation: repeated failed proposals from the same proposer raise its
// suspicion score; at the threshold the proposer is QUARANTINED and must be
// explicitly re-admitted. A corrupt node is cut out of the cluster without
// locking anyone else out.
//
//   const consensus = new ConsensusIsolation({ nodeId: 'klyn-a', quorumSize: 5, quantum, gate });
//   const { proposal, result } = await consensus.runQuorum(input, ['v1','v2','v3','v4','v5'], ['v5']);
//
// Pure TypeScript, reuses the Phase 8 post-quantum primitives — zero new
// dependencies.
// =============================================================================
import { createHash } from 'node:crypto';
import { QuantumZkLedger, deriveWotsKeyPair, wotsSign, wotsVerify, type KnowledgeProof } from '../kernel/src/security/quantum_zk.js';
import { QualityGate } from '../packages/self-healing-runtime/src/mutation_harness.js';
import { HybridLogicalClock, type HlcTime } from './temporal_causality.js';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type ConsensusKind = 'patch' | 'policy';

export interface ConsensusProposalInput {
  proposer: string;
  kind: ConsensusKind;
  /** Tracked ref the mutation targets (file path for patches, policy key for
   *  policy updates). */
  ref: string;
  /** Content before the mutation. */
  input: string;
  /** Candidate content after the mutation. */
  output: string;
  meta?: Record<string, unknown>;
}

export interface ConsensusProposal extends ConsensusProposalInput {
  /** sha256 of the canonical payload — the signed + ZK-bound statement. */
  id: string;
  inputHash: string;
  outputHash: string;
  hlc: HlcTime;
  at: number;
  /** Post-quantum WOTS+ signature over the canonical payload. */
  publicKey: string[];
  signature: string[];
  /** Fiat-Shamir ZK knowledge proof, statement bound to the proposal id. */
  zk: KnowledgeProof;
}

export interface ConsensusVote {
  proposalId: string;
  voter: string;
  approve: boolean;
  reason: string;
  hlc: HlcTime;
  at: number;
}

export interface ConsensusResult {
  proposalId: string;
  kind: ConsensusKind;
  ref: string;
  outputHash: string;
  approvals: number;
  rejections: number;
  /** Quorum size the majority is measured against. */
  quorum: number;
  committed: boolean;
  committedBy: string[];
  rejectedBy: string[];
  at: number;
}

export interface VerifyOutcome {
  ok: boolean;
  reasons: string[];
}

export interface ConsensusOptions {
  nodeId?: string;
  /** Cluster size the strict majority is measured against (default 5). */
  quorumSize?: number;
  /** Proposer-side ZK authority (defaults to a fresh ledger). */
  quantum?: QuantumZkLedger;
  /** Quality gate applied to every candidate output (default fresh). */
  gate?: QualityGate;
  /** Failed proposals before a proposer is quarantined (default 3). */
  quarantineThreshold?: number;
  clock?: HybridLogicalClock;
}

const DEFAULT_QUORUM = 5;
const DEFAULT_QUARANTINE = 3;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function defaultNodeId(): string {
  return process.env.KLYN_NODE_ID ?? 'klyn-node';
}

// -----------------------------------------------------------------------------
// CONSENSUS ISOLATION ENGINE
// -----------------------------------------------------------------------------

export class ConsensusIsolation {
  private readonly quantum: QuantumZkLedger;
  private readonly gate: QualityGate;
  private readonly clock: HybridLogicalClock;
  private readonly quorumSize: number;
  private readonly quarantineThreshold: number;
  private readonly proposals = new Map<string, ConsensusProposal>();
  private readonly votes = new Map<string, Map<string, ConsensusVote>>();
  private readonly results = new Map<string, ConsensusResult>();
  private readonly suspicion = new Map<string, number>();
  private readonly quarantined = new Set<string>();
  private readonly nodeId: string;
  private committedCount = 0;
  private rejectedCount = 0;

  constructor(options: ConsensusOptions = {}) {
    this.nodeId = options.nodeId ?? defaultNodeId();
    this.quorumSize = options.quorumSize ?? DEFAULT_QUORUM;
    this.quarantineThreshold = options.quarantineThreshold ?? DEFAULT_QUARANTINE;
    this.quantum = options.quantum ?? new QuantumZkLedger(`${this.nodeId}:consensus`);
    this.gate = options.gate ?? new QualityGate();
    this.clock = options.clock ?? new HybridLogicalClock(this.nodeId);
  }

  get quorum(): number {
    return this.quorumSize;
  }

  // -------------------------------------------------------------------------
  // PROPOSER SIDE
  // -------------------------------------------------------------------------

  /**
   * Create a signed proposal. The proposer derives a FRESH WOTS+ keypair
   * from (secret, proposalId), signs the canonical payload, and attaches a
   * ZK knowledge proof whose statement is the proposal id — so neither the
   * signature nor the proof can be replayed onto a different mutation.
   */
  propose(input: ConsensusProposalInput, secret: string): ConsensusProposal {
    if (this.isQuarantined(input.proposer)) {
      throw new Error(`ConsensusIsolation: proposer ${input.proposer} is quarantined — admit() it before proposing`);
    }
    const id = sha256(canonicalPayload(input));
    const keySeed = sha256(`${secret}:${id}`);
    const { secret: sk, publicKey } = deriveWotsKeyPair(keySeed);
    const proposal: ConsensusProposal = {
      ...input,
      id,
      inputHash: sha256(input.input),
      outputHash: sha256(input.output),
      hlc: this.clock.now(),
      at: Date.now(),
      publicKey,
      signature: wotsSign(id, sk).signature,
      zk: this.quantum.knowledgeProof(secret, id, `consensus:${id}`),
    };
    this.proposals.set(id, proposal);
    return proposal;
  }

  // -------------------------------------------------------------------------
  // VERIFIER SIDE (every honest voter runs this before voting)
  // -------------------------------------------------------------------------

  /**
   * Full cryptographic verification: (1) recompute the canonical id from the
   * payload, (2) re-verify the WOTS+ post-quantum signature over the id,
   * (3) verify the ZK knowledge proof is bound to the id, (4) confirm the
   * content hashes match the declared input/output, (5) run the Phase 3
   * quality gate on the candidate output. Any failure rejects the proposal.
   */
  verify(proposal: ConsensusProposal): VerifyOutcome {
    const reasons: string[] = [];
    const recomputedId = sha256(canonicalPayload({ proposer: proposal.proposer, kind: proposal.kind, ref: proposal.ref, input: proposal.input, output: proposal.output, meta: proposal.meta }));
    if (recomputedId !== proposal.id) reasons.push('proposal id does not match its payload');
    if (!wotsVerify(proposal.id, proposal.signature, proposal.publicKey)) reasons.push('WOTS+ post-quantum signature invalid');
    if (!QuantumZkLedger.verifyKnowledgeProof(proposal.zk)) reasons.push('ZK knowledge proof invalid');
    if (proposal.zk.statement !== proposal.id) reasons.push('ZK proof bound to a different statement');
    if (proposal.inputHash !== sha256(proposal.input)) reasons.push('input hash mismatch');
    if (proposal.outputHash !== sha256(proposal.output)) reasons.push('output hash mismatch');
    const gate = this.gate.evaluate({ code: proposal.output });
    if (!gate.approved) reasons.push(`quality gate rejected: ${gate.reasons.join('; ')}`);
    return { ok: reasons.length === 0, reasons };
  }

  // -------------------------------------------------------------------------
  // VOTING + RESULT (pure functions — lock-free)
  // -------------------------------------------------------------------------

  /** Cast one voter's vote. A voter may only vote once per proposal (later
   *  votes are ignored — first write wins, which is deterministic). */
  castVote(proposalId: string, voter: string, approve: boolean, reason = ''): ConsensusVote | null {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;
    const ballot = this.votes.get(proposalId) ?? new Map<string, ConsensusVote>();
    if (ballot.has(voter)) return null;
    const vote: ConsensusVote = { proposalId, voter, approve, reason, hlc: this.clock.now(), at: Date.now() };
    ballot.set(voter, vote);
    this.votes.set(proposalId, ballot);
    return vote;
  }

  /**
   * The consensus verdict — a PURE function of the votes already present:
   * committed iff approvals > quorumSize / 2. Repeated calls are stable.
   */
  result(proposalId: string): ConsensusResult | null {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;
    const existing = this.results.get(proposalId);
    if (existing) return existing;
    const ballot = Array.from(this.votes.get(proposalId)?.values() ?? []);
    const approvals = ballot.filter((v) => v.approve);
    const rejections = ballot.filter((v) => !v.approve);
    const committed = approvals.length > this.quorumSize / 2;
    const result: ConsensusResult = {
      proposalId,
      kind: proposal.kind,
      ref: proposal.ref,
      outputHash: proposal.outputHash,
      approvals: approvals.length,
      rejections: rejections.length,
      quorum: this.quorumSize,
      committed,
      committedBy: approvals.map((v) => v.voter).sort(),
      rejectedBy: rejections.map((v) => v.voter).sort(),
      at: Date.now(),
    };
    this.results.set(proposalId, result);
    if (committed) this.committedCount++;
    else this.rejectedCount++;
    return result;
  }

  // -------------------------------------------------------------------------
  // FULL ROUND (honest majority drive)
  // -------------------------------------------------------------------------

  /**
   * Run one complete consensus round: propose, have every voter verify
   * (malicious voters vote against or skip — they cannot forge), then read
   * the majority verdict. Honest voters approve only verified proposals, so
   * a tampered proposal never reaches the quorum.
   */
  async runQuorum(input: ConsensusProposalInput, voters: string[], malicious: string[] = [], secret = 'klyn-consensus-secret'): Promise<{ proposal: ConsensusProposal; result: ConsensusResult }> {
    const proposal = this.propose(input, secret);
    const self = this.verify(proposal);
    if (!self.ok) {
      // The proposer itself failed verification — record suspicion and
      // return an explicit rejection without any voter round.
      this.noteSuspicion(proposal.proposer);
      return { proposal, result: this.reject(proposal, self.reasons) };
    }
    for (const voter of voters) {
      if (this.isQuarantined(voter)) continue; // quarantined voters are excluded
      if (malicious.includes(voter)) {
        this.castVote(proposal.id, voter, false, 'malicious voter');
        continue;
      }
      const outcome = this.verify(proposal);
      this.castVote(proposal.id, voter, outcome.ok, outcome.reasons.join('; '));
    }
    const result = this.result(proposal.id)!;
    // Suspicion is only earned when a VOTING ROUND actually failed — a
    // fail-closed round with zero voters is a cluster-availability issue,
    // not a Byzantine one, and must never mark an honest proposer suspect.
    if (!result.committed && result.approvals + result.rejections > 0) this.noteSuspicion(proposal.proposer);
    return { proposal, result };
  }

  // -------------------------------------------------------------------------
  // ISOLATION (quarantine)
  // -------------------------------------------------------------------------

  /** Suspicion rises per failed proposal; at the threshold the proposer is
   *  quarantined and its proposals are refused outright. */
  private noteSuspicion(nodeId: string): void {
    if (this.isQuarantined(nodeId)) return;
    const score = (this.suspicion.get(nodeId) ?? 0) + 1;
    this.suspicion.set(nodeId, score);
    if (score >= this.quarantineThreshold) this.quarantined.add(nodeId);
  }

  isQuarantined(nodeId: string): boolean {
    return this.quarantined.has(nodeId);
  }

  /** Explicit re-admission after a quarantine. */
  admit(nodeId: string): void {
    this.quarantined.delete(nodeId);
    this.suspicion.delete(nodeId);
  }

  /** Immediate, programmatic quarantine (e.g. the quorum loop catches a
   *  rogue agent mid-epoch with an invalid ZK/WOTS proof). Sets suspicion to
   *  the threshold so the isolation is durable, not just a flag. */
  quarantine(nodeId: string, _reason = 'explicit quarantine'): void {
    this.suspicion.set(nodeId, this.quarantineThreshold);
    this.quarantined.add(nodeId);
  }

  suspicionOf(nodeId: string): number {
    return this.suspicion.get(nodeId) ?? 0;
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  getStats(): { nodeId: string; quorumSize: number; proposals: number; votes: number; committed: number; rejected: number; quarantined: string[] } {
    let votes = 0;
    for (const ballot of this.votes.values()) votes += ballot.size;
    return {
      nodeId: this.nodeId,
      quorumSize: this.quorumSize,
      proposals: this.proposals.size,
      votes,
      committed: this.committedCount,
      rejected: this.rejectedCount,
      quarantined: Array.from(this.quarantined).sort(),
    };
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private reject(proposal: ConsensusProposal, reasons: string[]): ConsensusResult {
    const result: ConsensusResult = {
      proposalId: proposal.id,
      kind: proposal.kind,
      ref: proposal.ref,
      outputHash: proposal.outputHash,
      approvals: 0,
      rejections: 0,
      quorum: this.quorumSize,
      committed: false,
      committedBy: [],
      rejectedBy: [],
      at: Date.now(),
    };
    this.results.set(proposal.id, result);
    this.rejectedCount++;
    void reasons;
    return result;
  }
}

/** Canonical proposal payload — the exact bytes the id, the WOTS+ signature,
 *  and the ZK statement all bind to. */
function canonicalPayload(input: ConsensusProposalInput): string {
  return JSON.stringify({
    proposer: input.proposer,
    kind: input.kind,
    ref: input.ref,
    input: input.input,
    output: input.output,
    meta: input.meta ?? {},
  });
}

export default ConsensusIsolation;
