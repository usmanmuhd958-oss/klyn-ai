// KLYN AI OS — swarm-mesh package entrypoint (Phase 6, Phase 7).
export { P2PNode, InMemoryTransport } from './p2p_node.js';
export type {
  MeshMessage,
  MeshMessageKind,
  MeshTransport,
  PeerRecord,
  OffloadResult,
  TaskHandler,
  P2PNodeOptions,
} from './p2p_node.js';
// Phase 7: self-healing fleet supervision for the mesh.
export { FleetOrchestrator } from './fleet_orchestrator.js';
export type { FleetNodeState, FleetOptions, FleetStats } from './fleet_orchestrator.js';
