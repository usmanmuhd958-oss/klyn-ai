// =============================================================================
// KLYN AI OS — swarm-mesh — SQLite Mesh Topology Store (Phase 14)
// File: packages/swarm-mesh/src/mesh_storage_sqlite.ts
//
// Phase 14 capability #2 (mesh half). The Phase 13 MeshStorage (JSON-L)
// rebuilt on the Phase 14 SqliteLedger (WAL + fsync) so the cluster's peer
// topology, per-peer reputation, and HLC vector clock survive cold boots in
// transaction-grade storage instead of plain append files.
// =============================================================================
import { SqliteLedger } from '../../../kernel/src/storage/sqlite_ledger.js';
import { MeshStorageBase } from './mesh_storage_base.js';

export type { PeerReputation, ColdBootRediscovery } from './mesh_storage_base.js';

export class MeshStorageSqlite extends MeshStorageBase {
  constructor(ledger: SqliteLedger) {
    super(ledger);
  }
}

export default MeshStorageSqlite;
