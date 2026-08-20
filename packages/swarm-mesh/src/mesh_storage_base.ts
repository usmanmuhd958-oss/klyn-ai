// =============================================================================
// KLYN AI OS — swarm-mesh — Persistent Mesh Topology & State Recovery (Phase 13)
// File: packages/swarm-mesh/src/mesh_storage_base.ts
//
// Phase 13 capability #2. Gives the federated mesh (Phase 12) a DURABLE
// memory: peer topology, per-peer reputation, and the HLC vector clock
// survive process restarts on any Phase 9 append-only ledger (JSON-L or
// SQLite), so a cold-booted node can re-discover its cluster instantly:
//
//   const storage = new MeshStorage(new JsonlLedger('./data/mesh'));
//   await storage.persistTopology(mesh.nodes());          // topology snapshot
//   await storage.persistReputation(nodeId, 3, true, 3);  // reputation event
//   await storage.persistVectorClock(mesh.engine.hlc);    // vector clock
//
//   // cold boot — no network, no gossip needed to rejoin the cluster:
//   const rediscovery = await storage.coldBootRediscovery(freshMesh, temporal);
//   rediscovery.peers          — every persisted peer, re-joined into the mesh
//   rediscovery.catchUpDelta   — deltaSince(0): the exact events a new node
//                                needs to converge (instant temporal catch-up)
//   rediscovery.vectorClock    — the last HLC the cluster reached
//
// Streams:
//   mesh_topology     — append-only snapshots of the peer table; restore is
//                       last-writer-wins per nodeId (a peer that left is
//                       simply absent from the newest snapshot that names it).
//   mesh_reputation   — append-only reputation events (failCount, quarantine,
//                       suspicion) feeding the consensus isolation engine.
//   mesh_vector_clock — the cluster's HLC watermark; restore returns the max.
//
// Append-only per stream, torn-tail tolerant, zero new dependencies.
// =============================================================================
import { FederatedMesh, type FederatedNode } from './federated_mesh.js';
import { TemporalCausality, type CausalEvent, type HlcTime } from '../../../1.brain/temporal_causality.js';

interface EngineLedger {
  append(stream: string, record: unknown): Promise<unknown>;
  readAll(stream: string): Promise<unknown[]>;
}

export interface TopologySnapshot {
  type: 'topology';
  at: number;
  nodes: FederatedNode[];
}

export interface ReputationEvent {
  type: 'reputation';
  at: number;
  nodeId: string;
  failCount: number;
  quarantined: boolean;
  suspicion: number;
}

export interface VectorClockRecord {
  type: 'vector_clock';
  at: number;
  hlc: HlcTime;
}

export interface PeerReputation {
  failCount: number;
  quarantined: boolean;
  suspicion: number;
}

export interface ColdBootRediscovery {
  /** Peers restored from the durable topology and joined into the mesh. */
  peers: FederatedNode[];
  /** deltaSince(0) — every causal event a fresh node needs to converge. */
  catchUpDelta: CausalEvent[];
  /** The cluster's last known HLC watermark (null when never persisted). */
  vectorClock: HlcTime | null;
  reputations: Record<string, PeerReputation>;
}

export class MeshStorageBase {
  protected static readonly TOPO = 'mesh_topology';
  protected static readonly REP = 'mesh_reputation';
  protected static readonly VEC = 'mesh_vector_clock';

  constructor(protected readonly ledger: EngineLedger) {}

  // ---- Topology -------------------------------------------------------------

  /** Append a full snapshot of the peer table. */
  async persistTopology(nodes: FederatedNode[]): Promise<void> {
    const snapshot: TopologySnapshot = {
      type: 'topology',
      at: Date.now(),
      nodes: nodes.map((n) => ({
        ...n,
        lastHlc: n.lastHlc ? { ...n.lastHlc } : null,
      })),
    };
    await this.ledger.append(MeshStorageBase.TOPO, snapshot);
  }

  /**
   * Restore the latest known state of every peer: walk snapshots newest
   * first, take each nodeId's FIRST occurrence (last writer wins), then
   * re-sort by nodeId for determinism.
   */
  async restoreTopology(): Promise<FederatedNode[]> {
    const records = await this.ledger.readAll(MeshStorageBase.TOPO);
    const latest = new Map<string, FederatedNode>();
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i] as Partial<TopologySnapshot> | undefined;
      if (record?.type !== 'topology' || !Array.isArray(record.nodes)) continue;
      for (const node of record.nodes) {
        if (!node || typeof node.nodeId !== 'string') continue;
        if (!latest.has(node.nodeId)) latest.set(node.nodeId, node);
      }
    }
    return Array.from(latest.values()).sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  }

  // ---- Reputation -----------------------------------------------------------

  /** Append one reputation event for a peer. */
  async persistReputation(nodeId: string, failCount: number, quarantined: boolean, suspicion: number): Promise<void> {
    const event: ReputationEvent = { type: 'reputation', at: Date.now(), nodeId, failCount, quarantined, suspicion };
    await this.ledger.append(MeshStorageBase.REP, event);
  }

  /** Restore the newest reputation of every peer (last writer wins). */
  async restoreReputations(): Promise<Record<string, PeerReputation>> {
    const records = await this.ledger.readAll(MeshStorageBase.REP);
    const out: Record<string, PeerReputation> = {};
    for (const record of records) {
      const event = record as Partial<ReputationEvent> | undefined;
      if (event?.type !== 'reputation' || typeof event.nodeId !== 'string') continue;
      out[event.nodeId] = {
        failCount: typeof event.failCount === 'number' ? event.failCount : 0,
        quarantined: event.quarantined === true,
        suspicion: typeof event.suspicion === 'number' ? event.suspicion : 0,
      };
    }
    return out;
  }

  // ---- Vector clock ---------------------------------------------------------

  /** Persist the cluster's HLC watermark (monotonic — append each time). */
  async persistVectorClock(hlc: HlcTime): Promise<void> {
    const record: VectorClockRecord = { type: 'vector_clock', at: Date.now(), hlc: { ...hlc } };
    await this.ledger.append(MeshStorageBase.VEC, record);
  }

  /** Restore the LAST (highest) persisted vector clock. */
  async restoreVectorClock(): Promise<HlcTime | null> {
    const records = await this.ledger.readAll(MeshStorageBase.VEC);
    let max: HlcTime | null = null;
    for (const record of records) {
      const rec = record as Partial<VectorClockRecord> | undefined;
      const hlc = rec?.hlc as HlcTime | undefined;
      if (!hlc || typeof hlc.wall !== 'number' || typeof hlc.counter !== 'number' || typeof hlc.nodeId !== 'string') continue;
      if (!max || hlc.wall > max.wall || (hlc.wall === max.wall && hlc.counter > max.counter)) max = { ...hlc };
    }
    return max;
  }

  // ---- Cold-boot re-discovery ------------------------------------------------

  /**
   * Full cold-boot recovery: restore the durable topology, re-join every
   * peer into the (fresh) mesh, and return the instant temporal catch-up
   * bundle — the exact event suffix a rebooted node needs to converge.
   */
  async coldBootRediscovery(mesh: FederatedMesh, temporal: TemporalCausality): Promise<ColdBootRediscovery> {
    const [peers, reputations, vectorClock] = await Promise.all([
      this.restoreTopology(),
      this.restoreReputations(),
      this.restoreVectorClock(),
    ]);
    for (const peer of peers) {
      mesh.join(peer.nodeId, { address: peer.address ?? undefined, seedHash: peer.seedHash ?? undefined });
      mesh.restorePeerState(peer.nodeId, { lastHlc: peer.lastHlc, lastSeq: peer.lastSeq, failCount: peer.failCount });
    }
    return {
      peers,
      catchUpDelta: temporal.deltaSince(0),
      vectorClock,
      reputations,
    };
  }
}
