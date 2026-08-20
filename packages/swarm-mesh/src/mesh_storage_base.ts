import type { EngineLedger } from '../../../kernel/src/storage/engine_persistence.js';
import { FederatedMesh, type FederatedNode } from './federated_mesh.js';
import { TemporalCausality, type CausalEvent, type HlcTime } from '../../../1.brain/temporal_causality.js';

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
  peers: FederatedNode[];
  catchUpDelta: CausalEvent[];
  vectorClock: HlcTime | null;
  reputations: Record<string, PeerReputation>;
}

export class MeshStorageBase {
  protected static readonly TOPO = 'mesh_topology';
  protected static readonly REP = 'mesh_reputation';
  protected static readonly VEC = 'mesh_vector_clock';

  constructor(protected readonly ledger: EngineLedger) {}

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

  async persistReputation(nodeId: string, failCount: number, quarantined: boolean, suspicion: number): Promise<void> {
    const event: ReputationEvent = { type: 'reputation', at: Date.now(), nodeId, failCount, quarantined, suspicion };
    await this.ledger.append(MeshStorageBase.REP, event);
  }

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

  async persistVectorClock(hlc: HlcTime): Promise<void> {
    const record: VectorClockRecord = { type: 'vector_clock', at: Date.now(), hlc: { ...hlc } };
    await this.ledger.append(MeshStorageBase.VEC, record);
  }

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
