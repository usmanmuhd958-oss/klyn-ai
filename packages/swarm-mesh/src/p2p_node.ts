// =============================================================================
// KLYN AI OS — swarm-mesh — Distributed P2P Mesh Swarm Node
// File: packages/swarm-mesh/src/p2p_node.ts
//
// Phase 6 capability #2. Decentralized peer-to-peer node discovery and
// distributed workload offloading over an injectable transport (WebRTC /
// WebSocket adapters implement MeshTransport; InMemoryTransport is provided
// for same-process meshes and tests):
//
//   node.start()                                  — announce + discover peers
//   node.onTask('patch_validate', handler)        — serve offloaded work
//   node.offload('patch_validate', payload)       — dispatch work to the
//                                                   least-loaded peer
//
// No central coordinator: every node discovers peers via hello/peers gossip,
// tracks per-peer load locally, and picks the least-loaded peer for each
// offload — the classic decentralized work pool. Memory is bounded (peer cap,
// pending-op cap, message-log cap) and every round-trip has a strict timeout.
//
// Idle edge workers use this to offload AST compilation, mutation validation,
// and synthetic test-suite execution without a central server bottleneck.
// =============================================================================

export type MeshMessageKind = 'hello' | 'hello_ack' | 'peers' | 'bye' | 'task' | 'task_result' | 'pong';

export interface MeshMessage {
  kind: MeshMessageKind;
  from: string;
  /** Destination node; undefined = broadcast. */
  to?: string;
  id?: string;
  payload?: unknown;
  at: number;
}

export interface MeshTransport {
  readonly nodeId: string;
  send(to: string, message: MeshMessage): void;
  broadcast(message: MeshMessage): void;
  onMessage(handler: (message: MeshMessage) => void): void;
  close(): void;
}

export interface PeerRecord {
  nodeId: string;
  lastSeen: number;
  /** In-flight tasks currently assigned to this peer (local view). */
  load: number;
}

export interface OffloadResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  from: string;
  latencyMs: number;
}

export interface TaskHandler {
  (payload: unknown): Promise<unknown> | unknown;
}

export interface P2PNodeOptions {
  /** Max tracked peers (default 32). */
  maxPeers?: number;
  /** Peer considered stale after this many ms (default 60s). */
  peerTimeoutMs?: number;
  /** Default offload round-trip budget (default 5s). */
  defaultTimeoutMs?: number;
  /** Max concurrent pending offloads (default 64). */
  maxPending?: number;
}

const DEFAULT_MAX_PEERS = 32;
const DEFAULT_PEER_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_PENDING = 64;

/** Same-process transport: routes messages through a shared hub — used by
 *  tests and by multi-node meshes inside one host. WebRTC/WebSocket adapters
 *  implement the same interface against real sockets. */
export class InMemoryTransport implements MeshTransport {
  static hub = new Map<string, InMemoryTransport>();
  readonly nodeId: string;
  private handlers = new Set<(message: MeshMessage) => void>();

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    InMemoryTransport.hub.set(nodeId, this);
  }

  send(to: string, message: MeshMessage): void {
    const target = InMemoryTransport.hub.get(to);
    target?.deliver(message);
  }

  broadcast(message: MeshMessage): void {
    for (const transport of InMemoryTransport.hub.values()) {
      if (transport.nodeId !== this.nodeId) transport.deliver(message);
    }
  }

  onMessage(handler: (message: MeshMessage) => void): void {
    this.handlers.add(handler);
  }

  close(): void {
    InMemoryTransport.hub.delete(this.nodeId);
    this.handlers.clear();
  }

  private deliver(message: MeshMessage): void {
    if (message.to !== undefined && message.to !== this.nodeId) return;
    for (const handler of this.handlers) {
      try {
        handler(message);
      } catch {
        // a peer's handler error must not break the mesh
      }
    }
  }
}

export class P2PNode {
  readonly nodeId: string;
  private peers = new Map<string, PeerRecord>();
  private handlers = new Map<string, TaskHandler>();
  private pending = new Map<string, { resolve: (r: OffloadResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  private tasksServed = 0;
  private tasksOffloaded = 0;
  private msgLog: string[] = [];

  private readonly maxPeers: number;
  private readonly peerTimeoutMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxPending: number;

  constructor(
    private transport: MeshTransport,
    options: P2PNodeOptions = {}
  ) {
    this.nodeId = transport.nodeId;
    this.maxPeers = options.maxPeers ?? DEFAULT_MAX_PEERS;
    this.peerTimeoutMs = options.peerTimeoutMs ?? DEFAULT_PEER_TIMEOUT_MS;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    transport.onMessage((message) => this.receive(message));
  }

  // -------------------------------------------------------------------------
  // DISCOVERY
  // -------------------------------------------------------------------------

  /** Announce ourselves and request peer lists from everyone we know. */
  start(): void {
    this.broadcast({ kind: 'hello', from: this.nodeId, payload: { knownPeers: Array.from(this.peers.keys()) }, at: Date.now() });
  }

  /** Join the mesh by greeting a specific bootstrap peer. */
  join(peerId: string): void {
    this.transport.send(peerId, { kind: 'hello', from: this.nodeId, payload: { knownPeers: Array.from(this.peers.keys()) }, at: Date.now() });
  }

  close(): void {
    this.broadcast({ kind: 'bye', from: this.nodeId, at: Date.now() });
    this.transport.close();
    for (const [, pending] of this.pending) clearTimeout(pending.timer);
    this.pending.clear();
  }

  // -------------------------------------------------------------------------
  // WORK OFFLOAD
  // -------------------------------------------------------------------------

  /** Serve offloaded work: register a handler for a task kind. */
  onTask(kind: string, handler: TaskHandler): void {
    this.handlers.set(kind, handler);
  }

  /**
   * Offload work to the least-loaded peer (no central scheduler — each node
   * decides locally). Falls back to the LOCAL handler when no peers exist,
   * so the mesh degrades gracefully to single-node operation.
   */
  async offload(kind: string, payload: unknown, timeoutMs: number = this.defaultTimeoutMs): Promise<OffloadResult> {
    this.pruneStalePeers();
    const peer = this.leastLoadedPeer();
    if (!peer) {
      const local = this.handlers.get(kind);
      if (!local) return { ok: false, error: `no peer and no local handler for "${kind}"`, from: this.nodeId, latencyMs: 0 };
      const t0 = performance.now();
      try {
        const result = await local(payload);
        this.tasksServed++;
        return { ok: true, result, from: this.nodeId, latencyMs: performance.now() - t0 };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), from: this.nodeId, latencyMs: performance.now() - t0 };
      }
    }

    if (this.pending.size >= this.maxPending) {
      return { ok: false, error: 'pending offload queue full (bounded memory)', from: this.nodeId, latencyMs: 0 };
    }

    const id = `t${this.nodeId.slice(0, 4)}-${++this.nextId}`;
    this.peers.get(peer.nodeId)!.load++;
    this.tasksOffloaded++;
    const started = performance.now();

    return new Promise<OffloadResult>((resolve) => {
      // NOTE: the budget timer is deliberately NOT unref'd — it must keep the
      // process alive until it fires. An offload must never be silently
      // abandoned because the event loop drained while a peer reply was due.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.peers.get(peer.nodeId)!.load = Math.max(0, this.peers.get(peer.nodeId)!.load - 1);
        resolve({ ok: false, error: `offload timed out after ${timeoutMs}ms`, from: peer.nodeId, latencyMs: performance.now() - started });
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          this.peers.get(peer.nodeId)!.load = Math.max(0, this.peers.get(peer.nodeId)!.load - 1);
          resolve(r);
        },
        timer,
      });
      this.transport.send(peer.nodeId, { kind: 'task', from: this.nodeId, to: peer.nodeId, id, payload: { kind, payload }, at: Date.now() });
    });
  }

  // -------------------------------------------------------------------------
  // MESSAGE HANDLING
  // -------------------------------------------------------------------------

  private receive(message: MeshMessage): void {
    if (message.from === this.nodeId) return;
    this.trackPeer(message.from);
    this.logMessage(message.kind);

    switch (message.kind) {
      case 'hello': {
        this.transport.send(message.from, { kind: 'hello_ack', from: this.nodeId, to: message.from, payload: { knownPeers: Array.from(this.peers.keys()) }, at: Date.now() });
        const theirPeers = (message.payload as { knownPeers?: string[] } | undefined)?.knownPeers ?? [];
        for (const peerId of theirPeers) {
          if (peerId !== this.nodeId && !this.peers.has(peerId) && this.peers.size < this.maxPeers) {
            this.transport.send(peerId, { kind: 'hello', from: this.nodeId, payload: { knownPeers: [] }, at: Date.now() });
          }
        }
        break;
      }
      case 'hello_ack': {
        const theirPeers = (message.payload as { knownPeers?: string[] } | undefined)?.knownPeers ?? [];
        for (const peerId of theirPeers) {
          if (peerId !== this.nodeId && !this.peers.has(peerId) && this.peers.size < this.maxPeers) {
            this.transport.send(peerId, { kind: 'hello', from: this.nodeId, payload: { knownPeers: [] }, at: Date.now() });
          }
        }
        break;
      }
      case 'task': {
        void this.serve(message);
        break;
      }
      case 'task_result': {
        const pending = this.pending.get(String(message.id));
        if (!pending) return;
        this.pending.delete(String(message.id));
        const { ok, result, error } = (message.payload ?? {}) as { ok?: boolean; result?: unknown; error?: string };
        pending.resolve({ ok: ok === true, result, error, from: message.from, latencyMs: 0 });
        break;
      }
      case 'bye': {
        this.peers.delete(message.from);
        break;
      }
      default:
        break;
    }
  }

  /** Serve a task: run the local handler and reply with the result. The first
   *  await guarantees replies NEVER land synchronously inside the dispatcher's
   *  loop — otherwise a fast (or handler-less) peer would report its load back
   *  to zero mid-dispatch and defeat the load balancing. */
  private async serve(message: MeshMessage): Promise<void> {
    await Promise.resolve();
    const { kind, payload } = (message.payload ?? {}) as { kind?: string; payload?: unknown };
    const handler = kind ? this.handlers.get(kind) : undefined;
    if (!handler) {
      this.transport.send(message.from, {
        kind: 'task_result',
        from: this.nodeId,
        to: message.from,
        id: message.id,
        payload: { ok: false, error: `no handler for "${kind}"` },
        at: Date.now(),
      });
      return;
    }
    this.tasksServed++;
    try {
      const result = await handler(payload);
      this.transport.send(message.from, {
        kind: 'task_result',
        from: this.nodeId,
        to: message.from,
        id: message.id,
        payload: { ok: true, result },
        at: Date.now(),
      });
    } catch (error) {
      this.transport.send(message.from, {
        kind: 'task_result',
        from: this.nodeId,
        to: message.from,
        id: message.id,
        payload: { ok: false, error: error instanceof Error ? error.message : String(error) },
        at: Date.now(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private trackPeer(peerId: string): void {
    const existing = this.peers.get(peerId);
    if (existing) {
      existing.lastSeen = Date.now();
      return;
    }
    if (this.peers.size >= this.maxPeers) return; // bounded peer table
    this.peers.set(peerId, { nodeId: peerId, lastSeen: Date.now(), load: 0 });
  }

  private pruneStalePeers(): void {
    const cutoff = Date.now() - this.peerTimeoutMs;
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen < cutoff) this.peers.delete(id);
    }
  }

  private leastLoadedPeer(): PeerRecord | null {
    let best: PeerRecord | null = null;
    for (const peer of this.peers.values()) {
      if (!best || peer.load < best.load) best = peer;
    }
    return best;
  }

  private broadcast(message: MeshMessage): void {
    this.transport.broadcast(message);
  }

  private logMessage(kind: MeshMessageKind): void {
    this.msgLog.push(kind);
    if (this.msgLog.length > 512) this.msgLog = this.msgLog.slice(-512);
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  peerList(): string[] {
    return Array.from(this.peers.keys()).sort();
  }

  peerCount(): number {
    return this.peers.size;
  }

  getStats(): { peers: number; tasksServed: number; tasksOffloaded: number; pending: number; msgLog: string[] } {
    return { peers: this.peers.size, tasksServed: this.tasksServed, tasksOffloaded: this.tasksOffloaded, pending: this.pending.size, msgLog: [...this.msgLog] };
  }
}

export default P2PNode;
