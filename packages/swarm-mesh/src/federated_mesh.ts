// =============================================================================
// KLYN AI OS — swarm-mesh — Federated Replica Swarm (Phase 12)
// File: packages/swarm-mesh/src/federated_mesh.ts
//
// Phase 12 capability #1. Connects independent self-replicated instances
// (Phase 11 `self_replication.ts` + `temporal_causality.ts`) into a global
// federated mesh. Every node owns its own TemporalCausality engine; peers
// exchange MINIMAL `deltaSince(seq)` causal suffixes and idempotent
// `mergeLogs` unions — no central coordinator, no full-state gossip:
//
//   const mesh = new FederatedMesh({ nodeId: 'klyn-a', temporal });
//   mesh.join('klyn-b', { address: 'termux:7860' });
//   mesh.receiveDelta('klyn-b', peerDelta);     // idempotent causal ingest
//   mesh.partition('klyn-b');                   // simulate network split
//   mesh.healSplitBrain('klyn-b', peerDelta);   // deterministic convergence
//
// 1. PEER REGISTRY — join/leave/heartbeat with liveness + per-peer last-seen
//    HLC/seq tracking. `nodes()` exposes the live cluster view.
//
// 2. CAUSAL STATE EXCHANGE — `produceDelta(fromSeq)` hands a peer exactly
//    what it is missing; `receiveDelta` ingests it (dedup by event id, HLC
//    absorption, local seq renumbering). Because every event carries a
//    hybrid logical clock stamp, the merge is order-independent and
//    idempotent — the CRDT-style causal sync of Phase 11.
//
// 3. SPLIT-BRAIN & PARTITION HEALING — when a partition heals, both sides
//    rebuild from the SAME deterministic union (`mergeLogs` dedup + total
//    HLC order). No event is lost (union, never overwrite), concurrent
//    mutations of the same ref converge to the same last-in-total-order
//    value on every node, and the mesh records a heal receipt.
//
// Fully synchronous, dependency-free (node:crypto not even needed here —
// the temporal engine carries the hashes), zero new packages.
// =============================================================================
import { TemporalCausality, type CausalEvent, type HlcTime } from '../../../1.brain/temporal_causality.js';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type PeerStatus = 'online' | 'partitioned' | 'offline';

export interface FederatedNode {
  nodeId: string;
  status: PeerStatus;
  joinedAt: number;
  lastSeen: number;
  /** Last known HLC of the peer (from the last delta it sent). */
  lastHlc: HlcTime | null;
  /** Last known event count of the peer. */
  lastSeq: number;
  /** Optional transport hint (address the peer listens on). */
  address: string | null;
  /** Optional Phase 11 replication seed root hash (identity proof). */
  seedHash: string | null;
  /** Consecutive failed exchanges — feeds consensus suspicion. */
  failCount: number;
}

export interface SyncReceipt {
  peer: string;
  applied: number;
  rejected: number;
  merged: boolean;
  localSeq: number;
  peerSeq: number;
  at: number;
}

export interface MeshOptions {
  nodeId?: string;
  /** This node's temporal causality engine (required — owns the state). */
  temporal: TemporalCausality;
  /** Max peers tracked (bounded memory). */
  maxPeers?: number;
}

const DEFAULT_MAX_PEERS = 256;

function defaultNodeId(): string {
  return process.env.KLYN_NODE_ID ?? 'klyn-node';
}

// -----------------------------------------------------------------------------
// FEDERATED MESH
// -----------------------------------------------------------------------------

export class FederatedMesh {
  readonly nodeId: string;
  private readonly temporal: TemporalCausality;
  private readonly maxPeers: number;
  private readonly peers = new Map<string, FederatedNode>();
  private exchanges = 0;
  private heals = 0;

  constructor(options: MeshOptions) {
    this.nodeId = options.nodeId ?? defaultNodeId();
    this.temporal = options.temporal;
    this.maxPeers = options.maxPeers ?? DEFAULT_MAX_PEERS;
  }

  /** The temporal causality engine this mesh node owns (state + log). */
  get engine(): TemporalCausality {
    return this.temporal;
  }

  // -------------------------------------------------------------------------
  // PEER REGISTRY
  // -------------------------------------------------------------------------

  /** Register a peer (join). Idempotent — re-join refreshes liveness. */
  join(nodeId: string, info: { address?: string; seedHash?: string } = {}): FederatedNode {
    if (this.peers.size >= this.maxPeers && !this.peers.has(nodeId)) {
      throw new Error(`FederatedMesh: peer table full (max ${this.maxPeers})`);
    }
    const existing = this.peers.get(nodeId);
    const now = Date.now();
    const node: FederatedNode = existing
      ? { ...existing, status: 'online', lastSeen: now, address: info.address ?? existing.address, seedHash: info.seedHash ?? existing.seedHash }
      : {
          nodeId,
          status: 'online',
          joinedAt: now,
          lastSeen: now,
          lastHlc: null,
          lastSeq: 0,
          address: info.address ?? null,
          seedHash: info.seedHash ?? null,
          failCount: 0,
        };
    this.peers.set(nodeId, node);
    return this.snapshot(node);
  }

  /** Deregister a peer. */
  leave(nodeId: string): boolean {
    return this.peers.delete(nodeId);
  }

  /** Liveness heartbeat — refreshes lastSeen and marks the peer online. */
  heartbeat(nodeId: string): boolean {
    const node = this.peers.get(nodeId);
    if (!node) return false;
    node.status = 'online';
    node.lastSeen = Date.now();
    return true;
  }

  /** Simulated network partition: the peer is unreachable until healed. */
  partition(nodeId: string): void {
    const node = this.peers.get(nodeId);
    if (node) node.status = 'partitioned';
  }

  /** Restore connectivity after a partition. */
  heal(nodeId: string): void {
    const node = this.peers.get(nodeId);
    if (node) node.status = 'online';
  }

  /** Live cluster view (sorted for determinism). */
  nodes(): FederatedNode[] {
    return Array.from(this.peers.values()).sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1)).map((n) => this.snapshot(n));
  }

  /** Online (non-partitioned, non-offline) peers. */
  onlinePeers(): string[] {
    return this.nodes().filter((n) => n.status === 'online').map((n) => n.nodeId);
  }

  peer(nodeId: string): FederatedNode | null {
    const node = this.peers.get(nodeId);
    return node ? this.snapshot(node) : null;
  }

  // -------------------------------------------------------------------------
  // CAUSAL STATE EXCHANGE
  // -------------------------------------------------------------------------

  /** The minimal delta a peer needs to catch up (events after fromSeq). */
  produceDelta(fromSeq = 0): CausalEvent[] {
    return this.temporal.deltaSince(fromSeq);
  }

  /** Ingest a peer's delta. Idempotent (event ids dedupe); updates the
   *  peer's last-seen HLC/seq. Returns a full receipt. */
  receiveDelta(peerNodeId: string, delta: CausalEvent[]): SyncReceipt {
    const node = this.peers.get(peerNodeId);
    if (!node) {
      throw new Error(`FederatedMesh: unknown peer ${peerNodeId} — join() it first`);
    }
    const before = this.temporal.seq;
    const applied = this.temporal.applyDelta(delta);
    const rejected = delta.length - applied;
    node.status = 'online';
    node.lastSeen = Date.now();
    node.lastSeq = before + applied;
    const last = delta.length > 0 ? delta[delta.length - 1].hlc : node.lastHlc;
    if (last) node.lastHlc = { ...last };
    this.exchanges++;
    return {
      peer: peerNodeId,
      applied,
      rejected,
      merged: false,
      localSeq: this.temporal.seq,
      peerSeq: node.lastSeq,
      at: Date.now(),
    };
  }

  // -------------------------------------------------------------------------
  // SPLIT-BRAIN & PARTITION HEALING
  // -------------------------------------------------------------------------

  /**
   * Deterministic reconciliation of a healed partition. Both sides of the
   * split rebuild from the SAME merged union (dedup by event id, total HLC
   * order), so every event survives (no data loss) and every node converges
   * to the identical state — including concurrent mutations of the same ref,
   * which resolve to the last writer in the deterministic total order.
   * Returns the heal receipt and the merged event count.
   */
  healSplitBrain(peerNodeId: string, peerDelta: CausalEvent[]): { receipt: SyncReceipt; merged: number } {
    const node = this.peers.get(peerNodeId);
    if (!node) {
      throw new Error(`FederatedMesh: unknown peer ${peerNodeId} — join() it first`);
    }
    const mine = this.temporal.logSnapshot();
    const merged = TemporalCausality.mergeLogs(mine, peerDelta);
    const count = this.temporal.rebuild(merged);
    node.status = 'online';
    node.lastSeen = Date.now();
    node.lastSeq = count;
    const last = merged.length > 0 ? merged[merged.length - 1].hlc : node.lastHlc;
    if (last) node.lastHlc = { ...last };
    this.exchanges++;
    this.heals++;
    return {
      receipt: {
        peer: peerNodeId,
        applied: merged.length - mine.length,
        rejected: 0,
        merged: true,
        localSeq: this.temporal.seq,
        peerSeq: count,
        at: Date.now(),
      },
      merged: count,
    };
  }

  /** A failed exchange marks suspicion on a peer (feeds consensus
   *  quarantine decisions; callers decide the threshold). */
  recordFailure(peerNodeId: string): void {
    const node = this.peers.get(peerNodeId);
    if (node) node.failCount++;
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  getStats(): { nodeId: string; peers: number; online: number; partitioned: number; exchanges: number; heals: number; localSeq: number } {
    const all = this.nodes();
    return {
      nodeId: this.nodeId,
      peers: all.length,
      online: all.filter((n) => n.status === 'online').length,
      partitioned: all.filter((n) => n.status === 'partitioned').length,
      exchanges: this.exchanges,
      heals: this.heals,
      localSeq: this.temporal.seq,
    };
  }

  /** Convenience: both sides of a partition heal against the SAME peer
   *  delta. Returns a pair of receipts (this node's view). */
  static convergesAfterHeal(
    a: FederatedMesh,
    b: FederatedMesh,
    deltaA: CausalEvent[],
    deltaB: CausalEvent[]
  ): { receiptA: SyncReceipt; receiptB: SyncReceipt; stateA: Record<string, string>; stateB: Record<string, string> } {
    const { receipt: receiptA, merged: mergedA } = a.healSplitBrain(b.nodeId, deltaB);
    const { receipt: receiptB, merged: mergedB } = b.healSplitBrain(a.nodeId, deltaA);
    if (mergedA !== mergedB) {
      throw new Error('FederatedMesh: healed partitions produced different merged lengths — non-deterministic merge');
    }
    return {
      receiptA,
      receiptB,
      stateA: a.temporal.stateSnapshot(),
      stateB: b.temporal.stateSnapshot(),
    };
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private snapshot(node: FederatedNode): FederatedNode {
    return {
      ...node,
      lastHlc: node.lastHlc ? { ...node.lastHlc } : null,
    };
  }
}

export default FederatedMesh;
