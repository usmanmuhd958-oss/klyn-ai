// =============================================================================
// KLYN AI OS — workflow-engine — Zero-Latency CRDT Event Bus & State Sync
// File: packages/workflow-engine/src/crdt_sync.ts
//
// Phase 4 capability #4. A Conflict-Free Replicated Data Type (CRDT) engine
// over the unified EventBus / WebSocket gateway. Multiple swarm agents and
// external CLI/editor clients can perform simultaneous AST mutations (each
// file — or symbol — is a ref) WITHOUT lock contention or race conditions.
//
//   crdt.mutate(ref, content)        — local write: lamport-clock bump +
//                                      publish to the unified bus (`crdt:update`)
//   crdt.attach(bus)                 — subscribe to remote replicas, apply
//                                      their updates (LWW total order)
//   crdt.merge(other)                — state-based merge (convergence proof)
//   crdt.materialize()               — { ref: content } for the patcher
//   crdt.toWire() / fromWire(json)   — wire format for WebSocket clients
//
// Convergence: every ref is an LWW-register with the total order
//   (lamport, version, timestamp, replicaId) — the same update set always
//   converges to the same state, in ANY application order. Lamport clocks
//   are monotonic per replica; the bus round-trip is in-process (zero
//   network latency for agents) and O(1) per ref.
// =============================================================================
import { EventBus, type KlynEvent } from '../../core-runtime/src/EventBus.js';

export const CRDT_UPDATE_EVENT = 'crdt:update';

export interface CRDTUpdate {
  replicaId: string;
  /** Ref being mutated: a file path, or a symbol key (`file#symbol`). */
  ref: string;
  /** New value; null = delete the ref (tombstone wins via LWW). */
  value: string | null;
  lamport: number;
  /** Per-ref version counter (from the mutating replica). */
  version: number;
  at: number;
}

export interface CRDTStateEntry {
  value: string | null;
  replicaId: string;
  lamport: number;
  version: number;
  at: number;
}

export interface CRDTMergeResult {
  applied: number;
  skipped: number;
  conflicts: number;
}

export class LWWRegisterCRDT {
  private state = new Map<string, CRDTStateEntry>();
  private lamport = 0;
  private versions = new Map<string, number>();
  private log: CRDTUpdate[] = [];
  private unsub: (() => void) | null = null;

  constructor(
    public readonly replicaId: string,
    private readonly bus: EventBus | null = null,
    private readonly logCap = 1024
  ) {
    if (bus) this.attach(bus);
  }

  get clock(): number {
    return this.lamport;
  }

  get refCount(): number {
    return this.state.size;
  }

  get(refless: string): string | null {
    return this.state.get(refless)?.value ?? null;
  }

  /** Local write: bump the lamport clock, publish to the bus if attached. */
  mutate(ref: string, value: string | null): CRDTUpdate {
    this.lamport++;
    const version = (this.versions.get(ref) ?? 0) + 1;
    this.versions.set(ref, version);
    const update: CRDTUpdate = {
      replicaId: this.replicaId,
      ref,
      value,
      lamport: this.lamport,
      version,
      at: Date.now(),
    };
    this.applyUpdate(update);
    this.bus?.publish({ type: CRDT_UPDATE_EVENT, payload: update, timestamp: update.at } satisfies KlynEvent);
    return update;
  }

  /** Attach to a unified bus: remote updates apply themselves (echo-guarded). */
  attach(bus: EventBus): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.unsub = bus.subscribe(CRDT_UPDATE_EVENT, (event) => {
      const update = event.payload as CRDTUpdate;
      if (!update || typeof update.replicaId !== 'string') return;
      if (update.replicaId === this.replicaId) return; // own echo
      this.applyRemote(update);
    });
  }

  detach(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  /**
   * Apply a REMOTE update: wins only when it beats the current state under
   * the total order (lamport, version, at, replicaId). Lamport clock always
   * advances to max(local, remote)+1 so causality chains stay ordered.
   */
  applyRemote(update: CRDTUpdate): boolean {
    this.lamport = Math.max(this.lamport, update.lamport) + 1;
    return this.applyUpdate(update);
  }

  /** Core LWW register write (shared by local + remote paths). */
  private applyUpdate(update: CRDTUpdate): boolean {
    const existing = this.state.get(update.ref);
    if (existing && !this.wins(update, existing)) return false;
    this.state.set(update.ref, {
      value: update.value,
      replicaId: update.replicaId,
      lamport: update.lamport,
      version: update.version,
      at: update.at,
    });
    this.log.push(update);
    if (this.log.length > this.logCap) {
      this.log = this.log.slice(-this.logCap);
    }
    return true;
  }

  /** Total order: higher (lamport, version, at, replicaId) wins. */
  private wins(a: CRDTUpdate, b: CRDTStateEntry): boolean {
    if (a.lamport !== b.lamport) return a.lamport > b.lamport;
    if (a.version !== b.version) return a.version > b.version;
    if (a.at !== b.at) return a.at > b.at;
    return a.replicaId > b.replicaId;
  }

  /** Batch-apply a set of updates (any order — converges to the same state). */
  applyBatch(updates: CRDTUpdate[]): CRDTMergeResult {
    const result: CRDTMergeResult = { applied: 0, skipped: 0, conflicts: 0 };
    for (const update of updates) {
      if (this.applyUpdate(update)) result.applied++;
      else result.skipped++;
    }
    return result;
  }

  /**
   * State-based merge: fold the other replica's full state in. Deterministic
   * LWW per ref — this is the convergence operation; run it after any
   * reconnect or snapshot sync.
   */
  merge(other: LWWRegisterCRDT | Map<string, CRDTStateEntry>): CRDTMergeResult {
    const entries = other instanceof LWWRegisterCRDT ? other.snapshot() : other;
    const result: CRDTMergeResult = { applied: 0, skipped: 0, conflicts: 0 };
    for (const [ref, entry] of entries) {
      const update: CRDTUpdate = {
        replicaId: entry.replicaId,
        ref,
        value: entry.value,
        lamport: entry.lamport,
        version: entry.version,
        at: entry.at,
      };
      if (this.applyUpdate(update)) result.applied++;
      else {
        result.skipped++;
        // A skipped LWW write with equal (lamport, version) but different
        // value is the only true conflict — count it for observability.
        const existing = this.state.get(ref);
        if (
          existing &&
          existing.lamport === entry.lamport &&
          existing.version === entry.version &&
          existing.value !== entry.value
        ) {
          result.conflicts++;
        }
      }
    }
    return result;
  }

  /** { ref: value } materialization for the patcher / file system layer. */
  materialize(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [ref, entry] of this.state) {
      if (entry.value !== null) out[ref] = entry.value;
    }
    return out;
  }

  /** Full state snapshot (for state-based merge + reconnect sync). */
  snapshot(): Map<string, CRDTStateEntry> {
    const out = new Map<string, CRDTStateEntry>();
    for (const [ref, entry] of this.state) {
      out.set(ref, { ...entry });
    }
    return out;
  }

  /** Wire format for WebSocket / external CLI clients (JSON). */
  toWire(): string {
    return JSON.stringify({ replicaId: this.replicaId, lamport: this.lamport, state: Array.from(this.snapshot().entries()) });
  }

  /** Apply a wire-format snapshot from another replica. */
  static fromWire(json: string, replicaId: string): LWWRegisterCRDT {
    const parsed = JSON.parse(json) as {
      replicaId: string;
      lamport: number;
      state: Array<[string, CRDTStateEntry]>;
    };
    const crdt = new LWWRegisterCRDT(replicaId);
    crdt.lamport = Math.max(crdt.lamport, parsed.lamport);
    for (const [ref, entry] of parsed.state) {
      crdt.applyUpdate({ replicaId: entry.replicaId, ref, value: entry.value, lamport: entry.lamport, version: entry.version, at: entry.at });
    }
    return crdt;
  }

  /** Recent updates (bounded) — delta sync for live connections. */
  recentUpdates(limit = 64): CRDTUpdate[] {
    return this.log.slice(-limit).map((u) => ({ ...u }));
  }
}

export default LWWRegisterCRDT;
