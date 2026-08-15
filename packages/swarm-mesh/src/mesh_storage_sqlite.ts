// =============================================================================
// KLYN AI OS — swarm-mesh — SQLite Mesh Topology Store (Phase 14)
// File: packages/swarm-mesh/src/mesh_storage_sqlite.ts
//
// Phase 14 capability #2 (mesh half). The Phase 13 MeshStorage (JSON-L)
// rebuilt on the Phase 14 SqliteLedger (WAL + fsync) so the cluster's peer
// topology, per-peer reputation, and HLC vector clock survive cold boots in
// transaction-grade storage instead of plain append files:
//
//   const storage = new MeshStorageSqlite(new SqliteLedger('./data/mesh.sqlite'));
//   await storage.persistTopology(mesh.nodes());
//   await storage.persistVectorClock(mesh.engine.hlc);
//   const rediscovery = await storage.coldBootRediscovery(freshMesh, temporal);
//
// API surface is identical to the JSON-L MeshStorage (same method names and
// shapes) so the healer, router, and smoke suites can swap storage engines
// without touching their call sites. Streams:
//   mesh_topology     — append-only snapshots; restore is last-writer-wins
//   mesh_reputation   — append-only reputation events
//   mesh_vector_clock — the cluster's HLC watermark; restore returns the max
// =============================================================================
import { SqliteLedger } from '../../../kernel/src/storage/sqlite_ledger.js';
import { FederatedMesh, type FederatedNode } from './federated_mesh.js';
import { TemporalCausality, type CausalEvent, type HlcTime } from '../../../1.brain/temporal_causality.js';

// -----------------------------------------------------------------------------
// TYPES (mirror MeshStorage)
// -----------------------------------------------------------------------------

export interface PeerReputation {
  failCount: number;
  quarantined: boolean;
  suspicion: number;
}

export interface ColdBootRediscovery {
  peers: FederatedNode[];
  catchUpDelta: CausalEvent[];
  vectorClock: HlcTime | null;
  reputations: Record<string, PeerReputation>;
}

// -----------------------------------------------------------------------------
// SQLITE MESH STORAGE
// -----------------------------------------------------------------------------

export class MeshStorageSqlite {
  private static readonly TOPO = 'mesh_topology';
  private static readonly REP = 'mesh_reputation';
  private static readonly VEC = 'mesh_vector_clock';

  constructor(private readonly ledger: SqliteLedger) {}

  // ---- Topology -------------------------------------------------------------

  /** Append a full snapshot of the peer table (atomic, durable). */
  async persistTopology(nodes: FederatedNode[]): Promise<void> {
    const snapshot = {
      type: 'topology',
      at: Date.now(),
      nodes: nodes.map((n) => ({
        ...n,
        lastHlc: n.lastHlc ? { ...n.lastHlc } : null,
      })),
    };
    await this.ledger.append(MeshStorageSqlite.TOPO, snapshot);
  }

  /** Restore the latest known state of every peer (last writer wins per
   *  nodeId — walk snapshots newest first, take first occurrence). */
  async restoreTopology(): Promise<FederatedNode[]> {
    const records = await this.ledger.readAll(MeshStorageSqlite.TOPO);
    const latest = new Map<string, FederatedNode>();
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i] as Partial<{ type: string; nodes: FederatedNode[] }> | undefined;
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
    await this.ledger.append(MeshStorageSqlite.REP, { type: 'reputation', at: Date.now(), nodeId, failCount, quarantined, suspicion });
  }

  /** Restore the newest reputation of every peer (last writer wins). */
  async restoreReputations(): Promise<Record<string, PeerReputation>> {
    const records = await this.ledger.readAll(MeshStorageSqlite.REP);
    const out: Record<string, PeerReputation> = {};
    for (const record of records) {
      const event = record as Partial<{ type: string; nodeId: string; failCount: number; quarantined: boolean; suspicion: number }> | undefined;
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
    await this.ledger.append(MeshStorageSqlite.VEC, { type: 'vector_clock', at: Date.now(), hlc: { ...hlc } });
  }

  /** Restore the LAST (highest) persisted vector clock. */
  async restoreVectorClock(): Promise<HlcTime | null> {
    const records = await this.ledger.readAll(MeshStorageSqlite.VEC);
    let max: HlcTime | null = null;
    for (const record of records) {
      const rec = record as Partial<{ type: string; hlc: HlcTime }> | undefined;
      const hlc = rec?.hlc;
      if (!hlc || typeof hlc.wall !== 'number' || typeof hlc.counter !== 'number' || typeof hlc.nodeId !== 'string') continue;
      if (!max || hlc.wall > max.wall || (hlc.wall === max.wall && hlc.counter > max.counter)) max = { ...hlc };
    }
    return max;
  }

  // ---- Cold-boot re-discovery ------------------------------------------------

  /** Full cold-boot recovery: restore the durable topology, re-join every
   *  peer into the (fresh) mesh, and return the instant temporal catch-up
   *  bundle — the exact event suffix a rebooted node needs to converge. */
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

export default MeshStorageSqlite;
