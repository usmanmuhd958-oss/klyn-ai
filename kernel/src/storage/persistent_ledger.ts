// =============================================================================
// KLYN AI OS — kernel — Durable Persistence Layer (Phase 9)
// File: kernel/src/storage/persistent_ledger.ts
//
// Phase 9 capability #2. Replaces in-memory-only state for the operational
// engines with durable, append-only, JSON-L persistence so the OS retains
// learned experiences, adaptive policies, post-quantum audit roots, and fleet
// supervision state across process restarts:
//
//   const ledger = new JsonlLedger('./data/klyn-ledger');
//   await ledger.append('quantum', { type: 'mutation', kind, ref, input, output, meta });
//   const events = await ledger.readAll('quantum');
//
//   const persistence = new EnginePersistence(ledger);
//   await persistence.persistQuantumMutation(qz, 'patch', ref, input, output, meta);
//   const qz2 = new QuantumZkLedger(seed);          // cold boot
//   await persistence.restoreQuantum(qz2);          // replay → IDENTICAL roots
//
// Cold-boot restoration is REPLAY-BASED for engines whose state is a pure
// function of an event stream (QuantumZkLedger, ExperienceLearner,
// AdaptivePolicyEngine — deterministic key derivation and Merkle commits make
// replay byte-exact, so historical Merkle/PQ roots and proofs reproduce
// identically) and SNAPSHOT-BASED for engines with mutable supervision state
// (FleetOrchestrator — liveness timestamps are restored as fresh).
//
// Append-only JSON-L per stream: one JSON object per line, appended with
// fs.appendFile (crash-safe: a torn final line is skipped on replay). No
// external database, no new dependencies — fits Termux, CI, and headless
// runs. Memory-bounded by the caller; files are plain text for auditability.
// =============================================================================
import { mkdir, appendFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { QuantumZkLedger } from '../security/quantum_zk.js';
import type { ExperienceLearner } from '../../../1.brain/experience_learner.js';
import type { AdaptivePolicyEngine } from '../../../1.brain/adaptive_policy.js';
import type { FleetOrchestrator, FleetNodeState } from '../../../packages/swarm-mesh/src/fleet_orchestrator.js';

// -----------------------------------------------------------------------------
// APPEND-ONLY JSON-L STORE
// -----------------------------------------------------------------------------

export interface JsonlStats {
  streams: string[];
  entries: Record<string, number>;
}

export class JsonlLedger {
  private readonly dir: string;
  private readonly known = new Set<string>();

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Append one JSON record to a stream (one object per line). */
  async append(stream: string, record: unknown): Promise<void> {
    if (!/^[a-zA-Z0-9._-]+$/.test(stream)) {
      throw new Error(`invalid ledger stream name: ${stream}`);
    }
    const file = this.fileFor(stream);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf-8');
    this.known.add(stream);
  }

  /** Read every record of a stream in order (torn final line skipped). */
  async readAll(stream: string): Promise<unknown[]> {
    const raw = await readFile(this.fileFor(stream), 'utf-8').catch(() => '');
    const out: unknown[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        break; // torn tail (crash mid-append) — stop, keep the valid prefix
      }
    }
    return out;
  }

  /** Read the last `n` records of a stream (newest last). */
  async readLast(stream: string, n: number): Promise<unknown[]> {
    const all = await this.readAll(stream);
    return all.slice(-n);
  }

  /** Entry count of a stream. */
  async size(stream: string): Promise<number> {
    return (await this.readAll(stream)).length;
  }

  /** Drop a stream entirely (tests, ledger rotation). */
  async reset(stream: string): Promise<void> {
    await rm(this.fileFor(stream), { force: true });
  }

  /** Streams appended to in this process (best-effort; a persisted dir may
   *  hold more). */
  async streams(): Promise<string[]> {
    return Array.from(this.known).sort();
  }

  /** Live stats: streams + per-stream entry counts (async reads). */
  async getStats(): Promise<JsonlStats> {
    const entries: Record<string, number> = {};
    for (const stream of this.known) {
      entries[stream] = await this.size(stream);
    }
    return { streams: Array.from(this.known).sort(), entries };
  }

  private fileFor(stream: string): string {
    return join(this.dir, `${stream}.jsonl`);
  }
}

// -----------------------------------------------------------------------------
// ENGINE PERSISTENCE ADAPTERS (replay/snapshot based)
// -----------------------------------------------------------------------------

export type PolicyPersistEvent =
  | { type: 'observe'; success: boolean; latencyMs?: number }
  | { type: 'activate'; draft: unknown; baseline?: { successRate?: number; avgLatencyMs?: number } };

export class EnginePersistence {
  constructor(private readonly ledger: JsonlLedger) {}

  // ---- QuantumZkLedger (replay-based — deterministic from masterSeed+seq) --

  /** Persist a mutation event AFTER it was committed to the quantum ledger. */
  async persistQuantumMutation(
    ledger: QuantumZkLedger,
    kind: 'patch' | 'state' | 'event',
    ref: string,
    input: string,
    output: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    await this.ledger.append('quantum', { type: 'mutation', kind, ref, input, output, meta });
  }

  /**
   * Cold-boot restore: replay every persisted mutation into a fresh ledger
   * (same masterSeed). Key derivation is deterministic, so the restored
   * ledger reproduces the SAME roots, signatures, and inclusion proofs —
   * historical Merkle/PQ audit state survives restarts byte-exact.
   */
  async restoreQuantum(ledger: QuantumZkLedger): Promise<number> {
    const events = await this.ledger.readAll('quantum');
    let restored = 0;
    for (const event of events) {
      const e = event as { type: string; kind?: 'patch' | 'state' | 'event'; ref?: string; input?: string; output?: string; meta?: Record<string, unknown> };
      if (e.type !== 'mutation') continue;
      if (!e.kind || typeof e.ref !== 'string' || typeof e.input !== 'string' || typeof e.output !== 'string') continue;
      ledger.commitMutation(e.kind, e.ref, e.input, e.output, e.meta ?? {});
      restored++;
    }
    return restored;
  }

  // ---- ExperienceLearner (replay-based) -------------------------------------

  /** Persist a learner record (call alongside learner.record). */
  async persistLearnerRecord(
    learner: ExperienceLearner,
    scope: string,
    key: string,
    success: boolean,
    latencyMs?: number,
    detail?: string
  ): Promise<void> {
    await this.ledger.append('experience', { type: 'record', scope, key, success, latencyMs, detail });
  }

  /** Cold-boot restore: replay recorded experiences — aggregates reproduce. */
  async restoreLearner(learner: ExperienceLearner): Promise<number> {
    const events = await this.ledger.readAll('experience');
    let restored = 0;
    for (const event of events) {
      const e = event as { type: string; scope?: string; key?: string; success?: boolean; latencyMs?: number; detail?: string };
      if (e.type !== 'record' || typeof e.scope !== 'string' || typeof e.key !== 'string' || typeof e.success !== 'boolean') continue;
      learner.record(e.scope, e.key, e.success, e.latencyMs, e.detail);
      restored++;
    }
    return restored;
  }

  // ---- AdaptivePolicyEngine (ordered event replay) ---------------------------

  /** Persist one policy event (observe or activate) in the order it happened. */
  async persistPolicyEvent(policy: AdaptivePolicyEngine, event: PolicyPersistEvent): Promise<void> {
    await this.ledger.append('policy', event);
  }

  /**
   * Cold-boot restore: replay observations + activations IN ORDER. Because
   * the policy engine's Merkle ledger and regression windows are pure
   * functions of this event stream, the restored engine has the same
   * versions, the same signed roots, and the same pending regression guard.
   */
  async restorePolicy(policy: AdaptivePolicyEngine): Promise<number> {
    const events = await this.ledger.readAll('policy');
    let restored = 0;
    for (const event of events) {
      const e = event as PolicyPersistEvent;
      if (e.type === 'observe') {
        policy.observe(e.success, e.latencyMs);
        restored++;
      } else if (e.type === 'activate' && typeof e.draft === 'object' && e.draft !== null) {
        policy.activate(e.draft as Parameters<AdaptivePolicyEngine['activate']>[0], e.baseline);
        restored++;
      }
    }
    return restored;
  }

  // ---- FleetOrchestrator (snapshot-based) ------------------------------------

  /** Persist a full snapshot of the fleet's node table. */
  async persistFleet(fleet: FleetOrchestrator): Promise<void> {
    const nodes = fleet.snapshotNodes();
    await this.ledger.append('fleet', { type: 'snapshot', nodes, at: Date.now() });
  }

  /** Cold-boot restore: re-register every persisted node with its state. */
  async restoreFleet(fleet: FleetOrchestrator): Promise<number> {
    const events = await this.ledger.readAll('fleet');
    let restored = 0;
    for (const event of events) {
      const e = event as { type: string; nodes?: FleetNodeState[] };
      if (e.type !== 'snapshot' || !Array.isArray(e.nodes)) continue;
      fleet.restoreNodes(e.nodes);
      restored += e.nodes.length;
    }
    return restored;
  }
}

export default EnginePersistence;
