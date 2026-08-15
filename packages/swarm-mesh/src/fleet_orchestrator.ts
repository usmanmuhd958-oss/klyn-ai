// =============================================================================
// KLYN AI OS — swarm-mesh — Self-Healing Fleet Orchestrator (Phase 7)
// File: packages/swarm-mesh/src/fleet_orchestrator.ts
//
// Phase 7 capability #3. The P2P mesh (Phase 6) is decentralized by design —
// no single coordinator picks peers. What it lacks is SUPERVISION: liveness
// tracking, quarantine of overloaded/erroring nodes, and rebalancing signals.
// The FleetOrchestrator provides exactly that, without reintroducing a
// central bottleneck:
//
//   fleet.registerNode(nodeId)             — join the supervised fleet
//   fleet.attach(node: P2PNode)            — register + poll real mesh stats
//   fleet.heartbeat(nodeId, load?)         — liveness + load telemetry
//   fleet.reportError(nodeId, detail?)     — error accounting → quarantine
//   fleet.tick()                           — sweep: death detection + recovery
//   fleet.rebalance()                      — reroute signals for bad nodes
//   fleet.recover(nodeId)                  — clear quarantine/revive
//
// Events are streamed on the EventBus ('fleet:node_lost', 'fleet:quarantine',
// 'fleet:recovered', 'fleet:rebalance') and repair hooks fire for the Phase 7
// EvolutionLoop to turn into swarm repair epochs. State is bounded (node table
// cap), deterministic, and fully synchronous — no timers, no hidden I/O.
// =============================================================================
import { EventBus, type KlynEvent } from '../../core-runtime/src/EventBus.js';
import type { P2PNode } from './p2p_node.js';

export interface FleetNodeState {
  nodeId: string;
  joinedAt: number;
  lastHeartbeat: number;
  /** Pending ops on the node (local view via stats poller). */
  load: number;
  /** Consecutive operational errors reported. */
  errors: number;
  quarantined: boolean;
  quarantineReason: string | null;
  dead: boolean;
}

export interface FleetOptions {
  /** Heartbeat grace before a node is marked dead (default 5_000 ms). */
  graceMs?: number;
  /** Pending ops before a node is quarantined as overloaded (default 8). */
  loadThreshold?: number;
  /** Consecutive errors before a node is quarantined (default 3). */
  errorThreshold?: number;
  /** Fleet size cap (default 64 — bounded memory). */
  maxNodes?: number;
  bus?: EventBus;
  /** Fired when a node needs repair attention (quarantine or death). */
  onRepairNeeded?: (nodeId: string, reason: string) => void;
  /** Fired when a node is lost (death sweep). */
  onNodeLost?: (nodeId: string) => void;
}

export interface FleetStats {
  nodes: number;
  healthy: number;
  quarantined: number;
  dead: number;
  totalErrors: number;
}

const DEFAULT_GRACE_MS = 5_000;
const DEFAULT_LOAD_THRESHOLD = 8;
const DEFAULT_ERROR_THRESHOLD = 3;
const DEFAULT_MAX_NODES = 64;

export class FleetOrchestrator {
  private nodes = new Map<string, FleetNodeState>();
  private pollers = new Map<string, () => number>();
  private bus: EventBus;
  private readonly graceMs: number;
  private readonly loadThreshold: number;
  private readonly errorThreshold: number;
  private readonly maxNodes: number;
  private readonly onRepairNeeded?: (nodeId: string, reason: string) => void;
  private readonly onNodeLost?: (nodeId: string) => void;

  constructor(options: FleetOptions = {}) {
    this.bus = options.bus ?? new EventBus();
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.loadThreshold = options.loadThreshold ?? DEFAULT_LOAD_THRESHOLD;
    this.errorThreshold = options.errorThreshold ?? DEFAULT_ERROR_THRESHOLD;
    this.maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    this.onRepairNeeded = options.onRepairNeeded;
    this.onNodeLost = options.onNodeLost;
  }

  // -------------------------------------------------------------------------
  // REGISTRATION
  // -------------------------------------------------------------------------

  /** Join a node to the supervised fleet (bounded table — rejects overflow). */
  registerNode(nodeId: string): boolean {
    if (this.nodes.has(nodeId)) return true;
    if (this.nodes.size >= this.maxNodes) return false;
    const now = Date.now();
    this.nodes.set(nodeId, {
      nodeId,
      joinedAt: now,
      lastHeartbeat: now,
      load: 0,
      errors: 0,
      quarantined: false,
      quarantineReason: null,
      dead: false,
    });
    return true;
  }

  /** Register a real P2PNode and poll its pending-op count for load. */
  attach(node: P2PNode): boolean {
    if (!this.registerNode(node.nodeId)) return false;
    this.pollers.set(node.nodeId, () => node.getStats().pending);
    return true;
  }

  /** Remove a node from the fleet (e.g. clean shutdown). */
  removeNode(nodeId: string): boolean {
    this.pollers.delete(nodeId);
    return this.nodes.delete(nodeId);
  }

  // -------------------------------------------------------------------------
  // TELEMETRY + SUPERVISION
  // -------------------------------------------------------------------------

  /** Liveness + load heartbeat. Revives a dead node whose heartbeat returns
   *  (the mesh healed or the node restarted). */
  heartbeat(nodeId: string, load?: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.lastHeartbeat = Date.now();
    node.load = load ?? this.pollers.get(nodeId)?.() ?? node.load;
    if (node.dead) {
      node.dead = false;
      node.errors = 0;
      this.publish('fleet:recovered', { nodeId });
    }
    // Overload quarantine: a node carrying more pending ops than the fleet
    // budget can sustain is pulled out of rotation until load drains.
    if (!node.dead && !node.quarantined && node.load >= this.loadThreshold) {
      this.quarantine(nodeId, `overload: ${node.load} pending ops ≥ ${this.loadThreshold}`);
    }
    // A healthy heartbeat clears an overload quarantine when load drains.
    if (node.quarantined && node.quarantineReason?.startsWith('overload') && node.load < this.loadThreshold) {
      this.clearQuarantine(node, 'load drained below threshold');
    }
  }

  /** Account one operational error; quarantine when the threshold trips. */
  reportError(nodeId: string, detail = 'unspecified'): boolean {
    const node = this.nodes.get(nodeId);
    if (!node || node.dead) return false;
    node.errors++;
    if (!node.quarantined && node.errors >= this.errorThreshold) {
      this.quarantine(nodeId, `error threshold reached (${node.errors}): ${detail}`);
      return true;
    }
    return false;
  }

  /** Quarantine a node: excluded from dispatch, repair hook fired once. */
  quarantine(nodeId: string, reason: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node || node.quarantined || node.dead) return false;
    node.quarantined = true;
    node.quarantineReason = reason;
    this.publish('fleet:quarantine', { nodeId, reason });
    this.onRepairNeeded?.(nodeId, reason);
    return true;
  }

  /** Clear quarantine (manual recovery or load-drain recovery). */
  recover(nodeId: string, reason = 'manual recovery'): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    if (!node.quarantined && !node.dead) return false;
    return this.clearQuarantine(node, reason);
  }

  /** One supervision sweep: mark silent nodes dead, revive stale flags. */
  tick(): void {
    const cutoff = Date.now() - this.graceMs;
    for (const node of this.nodes.values()) {
      if (!node.dead && node.lastHeartbeat < cutoff) {
        node.dead = true;
        node.load = 0;
        this.publish('fleet:node_lost', { nodeId: node.nodeId });
        this.onNodeLost?.(node.nodeId);
        this.onRepairNeeded?.(node.nodeId, `no heartbeat for ${this.graceMs}ms`);
      }
    }
  }

  /** Rebalance view: healthy dispatch targets after quarantine/death. Returns
   *  the rerouted (bad) nodes and emits a 'fleet:rebalance' event so callers
   *  (and the EvolutionLoop) can re-dispatch their in-flight work. */
  rebalance(): { rerouted: Array<{ nodeId: string; reason: string }>; targets: string[] } {
    const rerouted: Array<{ nodeId: string; reason: string }> = [];
    for (const node of this.nodes.values()) {
      if (node.quarantined) rerouted.push({ nodeId: node.nodeId, reason: node.quarantineReason ?? 'quarantined' });
      else if (node.dead) rerouted.push({ nodeId: node.nodeId, reason: 'dead' });
    }
    const targets = this.healthyNodes();
    if (rerouted.length > 0) {
      this.publish('fleet:rebalance', { rerouted, targets });
    }
    return { rerouted, targets };
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  node(nodeId: string): FleetNodeState | null {
    const state = this.nodes.get(nodeId);
    if (!state) return null;
    return { ...state };
  }

  healthyNodes(): string[] {
    return Array.from(this.nodes.values())
      .filter((n) => !n.dead && !n.quarantined)
      .map((n) => n.nodeId)
      .sort();
  }

  quarantinedNodes(): string[] {
    return Array.from(this.nodes.values())
      .filter((n) => n.quarantined)
      .map((n) => n.nodeId)
      .sort();
  }

  deadNodes(): string[] {
    return Array.from(this.nodes.values())
      .filter((n) => n.dead)
      .map((n) => n.nodeId)
      .sort();
  }

  stats(): FleetStats {
    let quarantined = 0;
    let dead = 0;
    let totalErrors = 0;
    for (const node of this.nodes.values()) {
      if (node.quarantined) quarantined++;
      if (node.dead) dead++;
      totalErrors += node.errors;
    }
    return {
      nodes: this.nodes.size,
      healthy: this.healthyNodes().length,
      quarantined,
      dead,
      totalErrors,
    };
  }

  /** Full snapshot of the node table (Phase 9 durable persistence). */
  snapshotNodes(): FleetNodeState[] {
    return Array.from(this.nodes.values()).map((n) => ({ ...n }));
  }

  /**
   * Cold-boot restoration (Phase 9): re-register persisted node states. The
   * table is replaced wholesale — liveness timestamps are restored as fresh
   * (a restarted fleet re-establishes liveness on the next heartbeat) while
   * load/error/quarantine/dead flags carry over exactly.
   */
  restoreNodes(states: FleetNodeState[]): void {
    this.nodes.clear();
    for (const state of states) {
      if (this.nodes.size >= this.maxNodes) break;
      this.nodes.set(state.nodeId, {
        nodeId: state.nodeId,
        joinedAt: state.joinedAt,
        lastHeartbeat: Date.now(),
        load: state.load,
        errors: state.errors,
        quarantined: state.quarantined,
        quarantineReason: state.quarantineReason,
        dead: state.dead,
      });
    }
  }

  /** Drop all supervision state (tests, fleet teardown). */
  dispose(): void {
    this.nodes.clear();
    this.pollers.clear();
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private clearQuarantine(node: FleetNodeState, reason: string): boolean {
    const wasQuarantined = node.quarantined;
    const wasDead = node.dead;
    node.quarantined = false;
    node.quarantineReason = null;
    node.dead = false;
    node.errors = 0;
    if (wasQuarantined || wasDead) {
      this.publish('fleet:recovered', { nodeId: node.nodeId, reason });
    }
    return true;
  }

  private publish(type: string, payload: Record<string, unknown>): void {
    this.bus.publish({ type, payload, timestamp: Date.now() } satisfies KlynEvent);
  }
}

export default FleetOrchestrator;
