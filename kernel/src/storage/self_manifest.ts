// =============================================================================
// KLYN AI OS — kernel — Self-Evolution Manifest (Phase 10)
// File: kernel/src/storage/self_manifest.ts
//
// The durable, tamper-evident record of every self-mutation Klyn performs on
// its own source. Each entry is hash-chained to the previous entry (SHA-256),
// so ANY rewrite of history is detectable by `verify()`:
//
//   const manifest = new SelfManifest(new JsonlLedger('./data/klyn-ledger'));
//   await manifest.append({ file, relFile, kind, severity, ..., outcome: 'committed', ... });
//   const verdict = await manifest.verify();   // { valid, entries, brokenAt }
//   const entry   = await manifest.findBySeq(3);
//   const restored = await loop.rollback(3);   // byte-exact pre-mutation restore
//
// Persistence rides the Phase 9 append-only JSON-L store (one object per
// line, crash-safe torn-tail skip) — the same ledger that already replays
// quantum roots and learner aggregates byte-exact on cold boot. Entries are
// also the ROLLBACK INDEX: each committed entry records the backup snapshot
// path taken before mutation, which the SelfHostingLoop restores verbatim.
// =============================================================================
import { createHash } from 'node:crypto';
import { JsonlLedger } from './persistent_ledger.js';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type ManifestOutcome = 'committed' | 'rejected' | 'rolled_back';

export interface ManifestEntryInput {
  /** Absolute path of the mutated file. */
  file: string;
  /** Repo-relative path (forward slashes) — the guard/graph key. */
  relFile: string;
  /** Finding kind (string — 'debug_log', 'todo_debt', 'latency', ...). */
  kind: string;
  severity: string;
  /** Blast radius measured by the Phase 8 graph query (null when unwired). */
  blastRadius: number | null;
  /** True when a self-hosting guard vetoed the mutation. */
  vetoed: boolean;
  vetoReason: string | null;
  outcome: ManifestOutcome;
  quantumSeq: number | null;
  merkleRoot: string | null;
  /** Snapshot path written before mutation (rollback source; null when vetoed). */
  backupPath: string | null;
  at: number;
}

export interface ManifestEntry extends ManifestEntryInput {
  /** Monotonic sequence — the rollback key. */
  seq: number;
  /** Hash of the previous entry ('' for the genesis entry). */
  prevHash: string;
  /** SHA-256 of this entry's canonical payload + prevHash. */
  hash: string;
}

export interface ManifestVerifyResult {
  valid: boolean;
  entries: number;
  /** 1-based seq of the first entry that breaks the chain (null when valid). */
  brokenAt: number | null;
}

// -----------------------------------------------------------------------------
// MANIFEST
// -----------------------------------------------------------------------------

const STREAM = 'selfhost';

export class SelfManifest {
  constructor(private readonly ledger: JsonlLedger) {}

  /** Append one chained entry. Returns the fully-materialized entry
   *  (seq + prevHash + hash) exactly as persisted. */
  async append(input: ManifestEntryInput): Promise<ManifestEntry> {
    const all = await this.all();
    const prev = all.length > 0 ? all[all.length - 1] : null;
    const entry: ManifestEntry = {
      ...input,
      seq: prev ? prev.seq + 1 : 1,
      prevHash: prev?.hash ?? '',
      hash: '',
    };
    entry.hash = this.hashOf(entry);
    await this.ledger.append(STREAM, entry);
    return entry;
  }

  /** Replay every entry in order (cold-boot restoration path). */
  async all(): Promise<ManifestEntry[]> {
    return (await this.ledger.readAll(STREAM)) as ManifestEntry[];
  }

  /** Verify the hash chain end-to-end. Any reordered, edited, or injected
   *  entry breaks the chain and is reported by seq. */
  async verify(): Promise<ManifestVerifyResult> {
    const entries = await this.all();
    let prevHash = '';
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.prevHash !== prevHash) return { valid: false, entries: entries.length, brokenAt: e.seq };
      if (e.hash !== this.hashOf(e)) return { valid: false, entries: entries.length, brokenAt: e.seq };
      prevHash = e.hash;
    }
    return { valid: true, entries: entries.length, brokenAt: null };
  }

  /** Look up one entry by seq (rollback target). */
  async findBySeq(seq: number): Promise<ManifestEntry | null> {
    const all = await this.all();
    return all.find((e) => e.seq === seq) ?? null;
  }

  /** Current entry count. */
  async size(): Promise<number> {
    return (await this.all()).length;
  }

  /** Drop the stream (tests, rotation). */
  async reset(): Promise<void> {
    await this.ledger.reset(STREAM);
  }

  private hashOf(e: ManifestEntry): string {
    // Canonical payload — fixed key order so JSON.stringify is deterministic.
    const canonical = {
      seq: e.seq,
      prevHash: e.prevHash,
      file: e.file,
      relFile: e.relFile,
      kind: e.kind,
      severity: e.severity,
      blastRadius: e.blastRadius,
      vetoed: e.vetoed,
      vetoReason: e.vetoReason,
      outcome: e.outcome,
      quantumSeq: e.quantumSeq,
      merkleRoot: e.merkleRoot,
      backupPath: e.backupPath,
      at: e.at,
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
}

export default SelfManifest;
