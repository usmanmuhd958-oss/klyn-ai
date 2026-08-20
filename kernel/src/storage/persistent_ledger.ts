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
import { EnginePersistence as SharedEnginePersistence } from './engine_persistence.js';
import type { PolicyPersistEvent } from './engine_persistence.js';

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

export type { PolicyPersistEvent } from './engine_persistence.js';

export class EnginePersistence extends SharedEnginePersistence {
  constructor(ledger: JsonlLedger) {
    super(ledger);
  }
}

export default EnginePersistence;
