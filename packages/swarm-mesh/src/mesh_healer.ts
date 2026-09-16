// =============================================================================
// KLYN AI OS — swarm-mesh — Self-Healing Mesh Convergence Engine (Phase 13)
// File: packages/swarm-mesh/src/mesh_healer.ts
//
// Phase 13 capability #3. Closes the loop on network partitions: the healer
// continuously monitors peer heartbeats, marks silent peers as partitioned,
// and — the moment a dropped node reconnects — runs an asynchronous
// background convergence loop that merges the divergent causal logs with the
// Phase 11 HLC machinery. No operator, no data loss:
//
//   const healer = new MeshHealer(mesh, storage);
//   const actions = healer.tick();                       // partition detection
//   const result = await healer.reconnect(peer, delta);  // convergence on heal
//   await healer.convergeAll(deltas);                    // background loop
//   await healer.persist();                              // durable topology
//
// ZERO DATA LOSS GUARANTEE — `verifyNoDataLoss` snapshots the node's event
// id set before a heal and asserts every id is still present after the
// union merge (dedup by id, total HLC order). By construction a union can
// never drop an event, but the healer verifies it on EVERY convergence so
// the guarantee is enforced, not assumed.
//
// Deterministic: the merged stream is the same pure function of
// (my log ∪ peer delta) on every node, so all healed replicas converge to
// the identical state. Fully synchronous except the async fs persistence —
// no timers, no hidden background threads (callers drive tick()).
// =============================================================================
import { FederatedMesh, type FederatedNode } from './federated_mesh.js';
import { MeshStorage } from './mesh_storage.js';
import { TemporalCausality, type CausalEvent } from '../../../1.brain/temporal_causality.js';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type HealActionKind = 'partitioned' | 'reconnected' | 'converged' | 'stale';

export interface HealAction {
  peer: string;
  action: HealActionKind;
  at: number;
  detail?: string;
}

export interface ConvergenceVerification {
  peer: string;
  beforeEvents: number;
  mergedEvents: number;
  /** Event ids present before the heal but missing after (must be empty). */
  lostIds: string[];
  noDataLoss: boolean;
}

export interface MeshHealerOptions {
  /** Seconds a peer may be silent before it is marked partitioned
   *  (default 30_000 ms). */
  heartbeatTimeoutMs?: number;
  /** Test seam: deterministic clock for partition detection. */
  now?: () => number;
}

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;

// -----------------------------------------------------------------------------
// MESH HEALER
// -----------------------------------------------------------------------------

export class MeshHealer {
  private readonly mesh: FederatedMesh;
  private readonly storage?: MeshStorage;
  private readonly heartbeatTimeoutMs: number;
  private readonly now: () => number;
  private convergences = 0;
  private partitionsDetected = 0;

  constructor(mesh: FederatedMesh, storage?: MeshStorage, options: MeshHealerOptions = {}) {
    this.mesh = mesh;
    this.storage = storage;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  // -------------------------------------------------------------------------
  // PARTITION DETECTION (continuous monitoring hook)
  // -------------------------------------------------------------------------

  /**
   * One monitoring sweep: any online peer whose last heartbeat is older than
   * the timeout is marked partitioned. Returns the actions taken. Call this
   * from the cluster's supervision loop (or the /v1/mesh/heal API).
   */
  tick(): HealAction[] {
    const actions: HealAction[] = [];
    const now = this.now();
    for (const node of this.mesh.nodes()) {
      if (node.nodeId === this.mesh.nodeId) continue;
      if (node.status === 'online' && now - node.lastSeen > this.heartbeatTimeoutMs) {
        this.mesh.partition(node.nodeId);
        this.partitionsDetected++;
        actions.push({ peer: node.nodeId, action: 'partitioned', at: now, detail: `silent for ${now - node.lastSeen}ms (> ${this.heartbeatTimeoutMs}ms)` });
      }
    }
    return actions;
  }

  /** Explicit heartbeat pass-through + reputation persistence. */
  async heartbeat(nodeId: string): Promise<boolean> {
    const ok = this.mesh.heartbeat(nodeId);
    if (ok && this.storage) {
      const node = this.mesh.peer(nodeId);
      if (node) await this.storage.persistReputation(nodeId, node.failCount, false, 0);
    }
    return ok;
  }

  /** Peers currently isolated (partitioned or offline) awaiting convergence. */
  pending(): string[] {
    return this.mesh.nodes().filter((n) => n.status !== 'online').map((n) => n.nodeId);
  }

  // -------------------------------------------------------------------------
  // CONVERGENCE (autonomous partition recovery)
  // -------------------------------------------------------------------------

  /**
   * Heal ONE reconnected peer: capture the pre-heal event ids, run the
   * deterministic split-brain merge, then VERIFY zero data loss. This is
   * the per-peer primitive of the background convergence loop.
   */
  async reconnect(peerNodeId: string, peerDelta: CausalEvent[]): Promise<{ action: HealAction; verification: ConvergenceVerification }> {
    const before = this.beforeIds();
    const { receipt, merged } = this.mesh.healSplitBrain(peerNodeId, peerDelta);
    const verification = this.verifyNoDataLoss(before, merged);
    const action: HealAction = {
      peer: peerNodeId,
      action: verification.noDataLoss ? 'converged' : 'stale',
      at: this.now(),
      detail: `merged=${merged} applied=${receipt.applied}`,
    };
    this.convergences++;
    if (this.storage) await this.storage.persistTopology(this.mesh.nodes());
    return { action, verification };
  }

  /**
   * The background convergence loop: converge every reconnected peer in
   * parallel (each heal is an independent deterministic merge — no locks
   * needed) and verify zero data loss on every branch. Returns per-peer
   * verifications; a stale branch (theoretically impossible for a union
   * merge, but checked anyway) is reported, never silently dropped.
   */
  async convergeAll(peerDeltas: Array<{ peer: string; delta: CausalEvent[] }>): Promise<ConvergenceVerification[]> {
    const results = await Promise.all(
      peerDeltas.map(async ({ peer, delta }) => {
        const { verification } = await this.reconnect(peer, delta);
        return verification;
      })
    );
    if (this.storage) await this.storage.persistTopology(this.mesh.nodes());
    return results;
  }

  // -------------------------------------------------------------------------
  // ZERO-DATA-LOSS VERIFICATION
  // -------------------------------------------------------------------------

  /** Snapshot of every event id currently in the mesh's causal log. */
  private beforeIds(): Set<string> {
    return new Set(this.mesh.engine.logSnapshot().map((e) => e.id));
  }

  /**
   * THE guarantee: after a union merge, every event id that existed BEFORE
   * must still exist AFTER. Returns the (empty) lost-id set and the verdict.
   */
  verifyNoDataLoss(before: Set<string>, mergedEvents: number): ConvergenceVerification {
    const after = new Set(this.mesh.engine.logSnapshot().map((e) => e.id));
    const lostIds: string[] = [];
    for (const id of before) {
      if (!after.has(id)) lostIds.push(id);
    }
    return {
      peer: this.mesh.nodeId,
      beforeEvents: before.size,
      mergedEvents,
      lostIds,
      noDataLoss: lostIds.length === 0,
    };
  }

  // -------------------------------------------------------------------------
  // PERSISTENCE HOOK
  // -------------------------------------------------------------------------

  /** Persist the current topology + vector clock to the durable store. */
  async persist(): Promise<void> {
    if (!this.storage) return;
    await this.storage.persistTopology(this.mesh.nodes());
    await this.storage.persistVectorClock(this.mesh.engine.hlc);
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  getStats(): { convergences: number; partitionsDetected: number; pending: string[]; nodes: FederatedNode[] } {
    return {
      convergences: this.convergences,
      partitionsDetected: this.partitionsDetected,
      pending: this.pending(),
      nodes: this.mesh.nodes(),
    };
  }
}

export default MeshHealer;
