// =============================================================================
// KLYN AI OS — 1.brain — Temporal Causality Engine (Phase 11)
// File: 1.brain/temporal_causality.ts
//
// Phase 11 capability #1. Gives the OS a memory of CAUSE, not just of state.
// Every autonomous epoch outcome, self-mutation, and tracked file change is
// stamped with a HYBRID LOGICAL CLOCK (HLC) — physical time fused with a
// logical counter — so events can be ordered causally across processes and
// across diverged replicas without any central coordinator:
//
//   const engine = new TemporalCausality({ nodeId: 'klyn-a', ledger });
//   engine.snapshot('src/app.ts', original);        // baseline capture
//   engine.mutate('src/app.ts', original, healed);  // causal state change
//   engine.rewind(seq);                             // TIME TRAVEL — exact
//                                                     reconstructed state at
//                                                     any causal point
//   engine.deltaSince(seq);                         // compact sync delta
//   other.applyDelta(delta);                        // causal catch-up
//
// 1. HYBRID LOGICAL CLOCK — wall-clock ms fused with a per-node logical
//    counter. `now()` produces a monotonically increasing stamp; `recv()`
//    absorbs a remote stamp so a node that hears about remote events can
//    never issue a stamp that would falsely "happen before" them. The
//    (wall, counter) pair is the causal partial order — two stamps are
//    concurrent iff neither happened before the other, which is exactly the
//    condition that detects diverged branches.
//
// 2. TIME TRAVEL — the engine keeps a compact causal event log (baseline
//    snapshots + full-output mutations). `rewind(seq)` replays the log up to
//    a causal point and returns the EXACT reconstructed state map — "git for
//    runtime state" — deterministic and byte-exact.
//
// 3. DURABLE COLD BOOT — when a Phase 9 JsonlLedger is wired, every event is
//    appended to the 'causal' stream. A fresh engine can `restore()` the log,
//    replay the HLC, and rebuild the state map — the OS wakes up remembering
//    exactly when and why things happened.
//
// 4. CAUSAL SYNC — `deltaSince(seq)` produces the minimal event suffix for a
//    replica to catch up; `applyDelta()` re-ingests it (absorbing HLC
//    stamps). `mergeLogs()` unions two diverged branches (dedup by event id,
//    ordered by the total HLC order) — the CRDT-style causal merge.
//
// Pure TypeScript, node:crypto sha256 only, zero new dependencies — fits
// Termux, headless CI, and the closed-loop epoch.
// =============================================================================
import { createHash } from 'node:crypto';
import { JsonlLedger } from '../kernel/src/storage/persistent_ledger.js';

// -----------------------------------------------------------------------------
// HYBRID LOGICAL CLOCK
// -----------------------------------------------------------------------------

export interface HlcTime {
  /** Physical component (epoch ms). */
  wall: number;
  /** Logical component (per-node counter). */
  counter: number;
  /** Node identity — tie-break for the deterministic total order. */
  nodeId: string;
}

/** Causal partial-order comparison (wall, then counter — NO nodeId, so two
 *  stamps from different nodes with the same (wall, counter) stay
 *  concurrent, which is the correct causality semantics for diverged
 *  branches). */
function compareCausal(a: HlcTime, b: HlcTime): -1 | 0 | 1 {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  return 0;
}

/** Deterministic TOTAL order (wall → counter → nodeId) for sorting merged
 *  logs — never used for causality, only for a stable merge sequence. */
function compareTotal(a: HlcTime, b: HlcTime): -1 | 0 | 1 {
  const causal = compareCausal(a, b);
  if (causal !== 0) return causal;
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
  return 0;
}

export class HybridLogicalClock {
  private wall = 0;
  private counter = 0;

  constructor(
    public readonly nodeId: string,
    private readonly physicalNow: () => number = Date.now
  ) {}

  /** Produce a fresh monotonically increasing local stamp. */
  now(): HlcTime {
    const pt = this.physicalNow();
    const l = Math.max(this.wall, pt);
    if (l === this.wall) this.counter += 1;
    else this.counter = 0;
    this.wall = l;
    return { wall: this.wall, counter: this.counter, nodeId: this.nodeId };
  }

  /** Absorb a REMOTE stamp: the local clock can never issue a stamp that
   *  would falsely precede an event it has already observed. */
  recv(remote: HlcTime): HlcTime {
    const pt = this.physicalNow();
    const l = Math.max(this.wall, remote.wall, pt);
    if (l === this.wall && l === remote.wall) this.counter = Math.max(this.counter, remote.counter) + 1;
    else if (l === this.wall) this.counter += 1;
    else if (l === remote.wall) this.counter = remote.counter + 1;
    else this.counter = 0;
    this.wall = l;
    return { wall: this.wall, counter: this.counter, nodeId: this.nodeId };
  }

  /** Current stamp WITHOUT advancing the clock. */
  peek(): HlcTime {
    return { wall: this.wall, counter: this.counter, nodeId: this.nodeId };
  }

  /** True when a happened-before b in the causal partial order. */
  static happenedBefore(a: HlcTime, b: HlcTime): boolean {
    return compareCausal(a, b) === -1;
  }

  /** True when neither stamp happened before the other (diverged branches). */
  static concurrent(a: HlcTime, b: HlcTime): boolean {
    return compareCausal(a, b) === 0 && (a.wall !== b.wall || a.counter !== b.counter || a.nodeId !== b.nodeId);
  }

  /** Total order (wall → counter → nodeId) for deterministic merging. */
  static compare(a: HlcTime, b: HlcTime): -1 | 0 | 1 {
    return compareTotal(a, b);
  }
}

// -----------------------------------------------------------------------------
// CAUSAL EVENT LOG
// -----------------------------------------------------------------------------

export type CausalEvent =
  | {
      /** Stable id: `${nodeId}:${seq}` — dedupe key for causal merges. */
      id: string;
      /** 1-based sequence in this node's log. */
      seq: number;
      type: 'snapshot';
      /** Tracked ref (file path, db key, event name). */
      ref: string;
      /** Full baseline content — the time-travel primitive. */
      content: string;
      hlc: HlcTime;
      at: number;
    }
  | {
      id: string;
      seq: number;
      type: 'mutate';
      ref: string;
      inputHash: string;
      output: string;
      outputHash: string;
      meta: Record<string, unknown>;
      hlc: HlcTime;
      at: number;
    };

export interface CausalStats {
  nodeId: string;
  seq: number;
  events: number;
  hlc: HlcTime;
  trackedRefs: string[];
  persisted: boolean;
  restored: number;
}

export interface TemporalOptions {
  nodeId?: string;
  clock?: HybridLogicalClock;
  /** Phase 9 durable store — events land in the 'causal' JSON-L stream. */
  ledger?: JsonlLedger;
  /** In-memory event retention cap (the ledger stays durable regardless). */
  maxMemoryEvents?: number;
}

const DEFAULT_MAX_MEMORY_EVENTS = 100_000;

function defaultNodeId(): string {
  return process.env.KLYN_NODE_ID ?? 'klyn-node';
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export class TemporalCausality {
  private clock: HybridLogicalClock;
  private readonly ledger?: JsonlLedger;
  private readonly maxMemoryEvents: number;
  private log: CausalEvent[] = [];
  private state = new Map<string, string>();
  private restored = 0;
  /** Serialized persistence chain: appends land in order; `flush()` awaits
   *  the tail so callers (and cold-boot tests) can be sure durability is
   *  reached before reading the ledger back. */
  private pending: Promise<void> = Promise.resolve();

  constructor(options: TemporalOptions = {}) {
    this.clock = options.clock ?? new HybridLogicalClock(options.nodeId ?? defaultNodeId());
    this.ledger = options.ledger;
    this.maxMemoryEvents = options.maxMemoryEvents ?? DEFAULT_MAX_MEMORY_EVENTS;
  }

  // -------------------------------------------------------------------------
  // RECORD (local events)
  // -------------------------------------------------------------------------

  /** Baseline capture of a tracked ref's content. */
  snapshot(ref: string, content: string): CausalEvent {
    const hlc = this.clock.now();
    const event: CausalEvent = {
      id: `${this.clock.nodeId}:${this.log.length + 1}`,
      seq: this.log.length + 1,
      type: 'snapshot',
      ref,
      content,
      hlc,
      at: Date.now(),
    };
    this.state.set(ref, content);
    return this.commit(event);
  }

  /** Causal state change: full output is retained so time travel can
   *  reconstruct the exact state at any point. */
  mutate(ref: string, input: string, output: string, meta: Record<string, unknown> = {}): CausalEvent {
    const hlc = this.clock.now();
    const event: CausalEvent = {
      id: `${this.clock.nodeId}:${this.log.length + 1}`,
      seq: this.log.length + 1,
      type: 'mutate',
      ref,
      inputHash: sha256(input),
      output,
      outputHash: sha256(output),
      meta,
      hlc,
      at: Date.now(),
    };
    this.state.set(ref, output);
    return this.commit(event);
  }

  /** Convenience: capture a before/after file pair (the epoch heal path). */
  recordFileChange(ref: string, before: string, after: string, meta: Record<string, unknown> = {}): CausalEvent {
    if (!this.state.has(ref)) this.snapshot(ref, before);
    return this.mutate(ref, before, after, meta);
  }

  // -------------------------------------------------------------------------
  // TIME TRAVEL
  // -------------------------------------------------------------------------

  /** Reconstruct the EXACT tracked state at a causal point (seq events
   *  applied, in order). seq 0 = genesis (empty state). */
  rewind(seq: number): { point: HlcTime | null; state: Record<string, string>; events: number } {
    const state: Record<string, string> = {};
    let point: HlcTime | null = null;
    let events = 0;
    for (const e of this.log) {
      if (e.seq > seq) break;
      if (e.type === 'snapshot') state[e.ref] = e.content;
      else state[e.ref] = e.output;
      point = e.hlc;
      events++;
    }
    return { point, state, events };
  }

  /** The HLC stamp of a given event seq (null when unknown). */
  hlcOf(seq: number): HlcTime | null {
    const event = this.log.find((e) => e.seq === seq);
    return event ? event.hlc : null;
  }

  // -------------------------------------------------------------------------
  // CAUSAL SYNC
  // -------------------------------------------------------------------------

  /** Minimal suffix of the log for a replica to catch up (events after
   *  `sinceSeq`). */
  deltaSince(sinceSeq: number): CausalEvent[] {
    return this.log.filter((e) => e.seq > sinceSeq).map((e) => this.cloneEvent(e));
  }

  /** Ingest a remote event: absorb its HLC stamp, append to the log, and
   *  apply it to the state map (idempotent by event id). The event's seq is
   *  RENUMBERED to its local position so `deltaSince(seq)` and `rewind(seq)`
   *  always mean "position in this node's log" even after merges. Returns
   *  the applied event or null when the id is already known. */
  ingest(event: CausalEvent): CausalEvent | null {
    const hydrated = this.hydrate(event);
    if (!hydrated) return null;
    if (this.log.some((e) => e.id === hydrated.id)) return null;
    this.clock.recv(hydrated.hlc);
    hydrated.seq = this.log.length + 1;
    this.log.push(hydrated);
    if (this.log.length > this.maxMemoryEvents) {
      this.log = this.log.slice(-this.maxMemoryEvents);
    }
    if (hydrated.type === 'snapshot') this.state.set(hydrated.ref, hydrated.content);
    else this.state.set(hydrated.ref, hydrated.output);
    return hydrated;
  }

  /** Catch a replica up: ingest every event of a delta in order. */
  applyDelta(delta: CausalEvent[]): number {
    let applied = 0;
    for (const event of delta) {
      if (this.ingest(event)) applied++;
    }
    return applied;
  }

  /**
   * Replace the ENTIRE log with a merged stream (the mesh split-brain heal
   * path). Events are sorted into the deterministic total HLC order, local
   * seqs are renumbered to position (so deltaSince/rewind stay meaningful),
   * the state map is rebuilt from the merged stream, and every stamp is
   * absorbed into the clock. Pure function of the input — both sides of a
   * healed partition rebuild from the SAME merge, so they converge
   * byte-exactly. Returns the merged event count.
   */
  rebuild(events: CausalEvent[]): number {
    const sorted = [...events]
      .sort((a, b) => HybridLogicalClock.compare(a.hlc, b.hlc))
      .map((e, i) => {
        const hydrated = this.hydrate(e);
        if (!hydrated) return null;
        hydrated.seq = i + 1;
        return hydrated;
      })
      .filter((e): e is CausalEvent => e !== null);
    const state = new Map<string, string>();
    for (const event of sorted) {
      this.clock.recv(event.hlc);
      if (event.type === 'snapshot') state.set(event.ref, event.content);
      else state.set(event.ref, event.output);
    }
    this.log = sorted;
    this.state = state;
    this.restored = sorted.length;
    return sorted.length;
  }

  /** CRDT-style causal merge: union of two diverged logs (dedup by event id)
   *  ordered by the deterministic total HLC order. Pure — callers decide
   *  which merged log wins. */
  static mergeLogs(a: CausalEvent[], b: CausalEvent[]): CausalEvent[] {
    const byId = new Map<string, CausalEvent>();
    for (const e of [...a, ...b]) byId.set(e.id, e);
    return Array.from(byId.values()).sort((x, y) => HybridLogicalClock.compare(x.hlc, y.hlc));
  }

  // -------------------------------------------------------------------------
  // DURABLE PERSISTENCE (cold boot)
  // -------------------------------------------------------------------------

  /** Rebuild the engine from the durable 'causal' ledger stream: replay the
   *  event log, re-absorb every HLC stamp, and reconstruct the state map. */
  async restore(): Promise<number> {
    if (!this.ledger) return 0;
    const raw = await this.ledger.readAll('causal');
    const events: CausalEvent[] = [];
    const state = new Map<string, string>();
    for (const record of raw) {
      const event = this.hydrate(record as CausalEvent);
      if (!event) continue;
      events.push(event);
      if (event.type === 'snapshot') state.set(event.ref, event.content);
      else state.set(event.ref, event.output);
    }
    this.log = events;
    this.state = state;
    this.restored = events.length;
    for (const event of events) this.clock.recv(event.hlc);
    return this.restored;
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  /** Current HLC stamp WITHOUT advancing the clock. */
  get hlc(): HlcTime {
    return this.clock.peek();
  }

  /** Current event count (= highest seq on this node). */
  get seq(): number {
    return this.log.length;
  }

  get eventCount(): number {
    return this.log.length;
  }

  stats(): CausalStats {
    return {
      nodeId: this.clock.nodeId,
      seq: this.log.length,
      events: this.log.length,
      hlc: this.clock.peek(),
      trackedRefs: Array.from(this.state.keys()).sort(),
      persisted: this.ledger !== undefined,
      restored: this.restored,
    };
  }

  /** In-memory log snapshot (cloned — safe to serialize). */
  logSnapshot(): CausalEvent[] {
    return this.log.map((e) => this.cloneEvent(e));
  }

  /** Current tracked state map. */
  stateSnapshot(): Record<string, string> {
    return Object.fromEntries(this.state);
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private commit(event: CausalEvent): CausalEvent {
    this.log.push(event);
    if (this.log.length > this.maxMemoryEvents) {
      this.log = this.log.slice(-this.maxMemoryEvents);
    }
    if (this.ledger) {
      // Appends are serialized so order in the durable stream matches the
      // causal log exactly. Failures are swallowed (the in-memory log keeps
      // the truth) but never break the chain — the next append still lands.
      this.pending = this.pending.then(() => this.ledger!.append('causal', event)).catch(() => {});
    }
    return event;
  }

  /** Await durability: resolves when every committed event has been appended
   *  to the ledger (no-op when no ledger is wired). Call before a cold-boot
   *  `restore()` reads the stream back. */
  async flush(): Promise<void> {
    await this.pending;
  }

  /** Validate + reconstruct an event from a JSON round-trip (defensive — the
   *  ledger is append-only but a torn line or an old schema must never
   *  crash the engine). */
  private hydrate(raw: unknown): CausalEvent | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.seq !== 'number' || typeof e.ref !== 'string') return null;
    const hlc = e.hlc as Record<string, unknown> | undefined;
    if (typeof hlc !== 'object' || hlc === null) return null;
    if (typeof hlc.wall !== 'number' || typeof hlc.counter !== 'number' || typeof hlc.nodeId !== 'string') return null;
    const stamp: HlcTime = { wall: hlc.wall, counter: hlc.counter, nodeId: hlc.nodeId };
    if (e.type === 'snapshot' && typeof e.content === 'string') {
      return { id: e.id, seq: e.seq, type: 'snapshot', ref: e.ref, content: e.content, hlc: stamp, at: typeof e.at === 'number' ? e.at : 0 };
    }
    if (e.type === 'mutate' && typeof e.output === 'string' && typeof e.inputHash === 'string') {
      return {
        id: e.id,
        seq: e.seq,
        type: 'mutate',
        ref: e.ref,
        inputHash: e.inputHash,
        output: e.output,
        outputHash: typeof e.outputHash === 'string' ? e.outputHash : sha256(e.output),
        meta: typeof e.meta === 'object' && e.meta !== null ? (e.meta as Record<string, unknown>) : {},
        hlc: stamp,
        at: typeof e.at === 'number' ? e.at : 0,
      };
    }
    return null;
  }

  private cloneEvent(event: CausalEvent): CausalEvent {
    if (event.type === 'snapshot') {
      return { ...event, hlc: { ...event.hlc } };
    }
    return { ...event, hlc: { ...event.hlc }, meta: { ...event.meta } };
  }
}

export default TemporalCausality;
