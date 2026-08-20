// =============================================================================
// KLYN AI OS — swarm-mesh — Durable Topology + Reputation Store (Phase 13)
// File: packages/swarm-mesh/src/mesh_storage.ts
//
// Phase 13 capability #2. Crash-safe, append-only JSON-L persistence for the
// federated mesh: peer topology snapshots, per-peer reputation events, and the
// HLC vector-clock watermark. Cold boot restores all three and returns the
// exact temporal catch-up delta a rebooted node needs to converge.
// =============================================================================
import { JsonlLedger } from '../../../kernel/src/storage/persistent_ledger.js';
import { MeshStorageBase } from './mesh_storage_base.js';

export type {
  TopologySnapshot,
  ReputationEvent,
  VectorClockRecord,
  PeerReputation,
  ColdBootRediscovery,
} from './mesh_storage_base.js';

export class MeshStorage extends MeshStorageBase {
  constructor(ledger: JsonlLedger) {
    super(ledger);
  }
}

export default MeshStorage;
