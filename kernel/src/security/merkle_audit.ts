// =============================================================================
// KLYN AI OS — kernel — Cryptographic Merkle Audit Trail & State Rollback
// File: kernel/src/security/merkle_audit.ts
//
// Phase 4 capability #3. A LOCK-FREE Merkle tree ledger that signs every
// agent code mutation, event execution, and state transition:
//
//   audit.commitFile(ref, content, meta)   — sign an fs mutation (sha-256 leaf)
//   audit.commitState(ref, value, meta)    — sign a db key/value transition
//   audit.verify(root?)                    — recompute the root from the
//                                            journal and compare (cryptographic
//                                            verification under test)
//   audit.verifyChain()                    — every entry's prevRoot chains
//   audit.proof(ref)                       — merkle inclusion proof (sibling
//                                            path, verifiable in O(log n))
//   audit.rollbackToMerkleRoot(root)       — atomic restore of fs + db state
//                                            to a historical root via injected
//                                            appliers (wrap them in the Phase 6
//                                            TransactionalPatcher overlay for
//                                            cross-surface atomicity)
//
// Lock-free by construction: the JS event loop is single-threaded, so the
// journal is append-only and every root is a PURE function of the journal
// state — no mutexes, no spinlocks. The sequence number is the only ordering
// primitive, exactly like the swarm's epoch counter.
//
// Merkle construction: leaves are the current per-ref (hash, version) state
// sorted by ref; the tree is built bottom-up, each parent = sha256(min(a,b) +
// max(a,b)) — deterministic regardless of insert order.
// =============================================================================
import { createHash } from 'node:crypto';

export type AuditSurface = 'fs' | 'db';

export interface AuditLeaf {
  ref: string;
  hash: string;
  version: number;
  kind: AuditSurface;
}

export interface MerkleEntry {
  seq: number;
  ref: string;
  hash: string;
  version: number;
  kind: AuditSurface;
  prevRoot: string;
  root: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

export interface MerkleProofStep {
  sibling: string;
  /** 'left' | 'right' — position of the sibling relative to the node. */
  position: 'left' | 'right';
}

export interface MerkleProof {
  ref: string;
  /** Content hash of the leaf payload (sha-256 of the content). */
  hash: string;
  /** Tree-level leaf node hash: sha256(ref:version:hash) — the verifier
   *  replays the sibling path from this value. */
  leafHash: string;
  root: string;
  path: MerkleProofStep[];
}

export interface RestoreOp {
  ref: string;
  kind: AuditSurface;
  currentHash: string;
  targetHash: string;
  /** True when the ref must be REMOVED at the target root (not present). */
  delete: boolean;
  /** Restore content for fs refs (null when unavailable/evicted). */
  content: string | null;
  /** Restore value for db refs. */
  value: unknown;
  available: boolean;
}

export interface RollbackResult {
  ok: boolean;
  targetRoot: string;
  ops: RestoreOp[];
  applied: number;
  errors: string[];
}

export interface AuditAppliers {
  /** Atomic fs restore writer (receives the full op — check op.delete for
   *  removals). Wrap in the Phase 6 TransactionalPatcher for cross-surface
   *  atomicity. */
  fs?: (op: RestoreOp) => Promise<void> | void;
  /** Atomic db restore writer (receives the full op — check op.delete for
   *  removals). */
  db?: (op: RestoreOp) => Promise<void> | void;
}

interface RefHistory {
  ref: string;
  kind: AuditSurface;
  versions: Array<{ version: number; hash: string; content: string | null; value: unknown; seq: number }>;
}

/** sha-256 hex digest (the leaf/root hash primitive). */
export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/** Deterministic pair hash: children are sorted before hashing. */
export function hashPair(a: string, b: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return sha256(`${lo}${hi}`);
}

/** Genesis root: the empty-state root every chain starts from. */
export const GENESIS_ROOT = sha256('klyn-genesis-v670');

export interface MerkleAuditOptions {
  /** Max retained content versions per ref (default 64 — rollback depth). */
  maxContentVersions?: number;
  /** Max journal entries retained (default 65_536). */
  maxJournal?: number;
  /** Optional restore appliers; rollback uses them when provided. */
  appliers?: AuditAppliers;
}

export class MerkleAudit {
  private journal: MerkleEntry[] = [];
  private live = new Map<string, { hash: string; version: number; kind: AuditSurface }>();
  private history = new Map<string, RefHistory>();
  private seq = 0;
  private readonly maxContentVersions: number;
  private readonly maxJournal: number;
  private readonly appliers: AuditAppliers;

  constructor(options: MerkleAuditOptions = {}) {
    this.maxContentVersions = options.maxContentVersions ?? 64;
    this.maxJournal = options.maxJournal ?? 65_536;
    this.appliers = options.appliers ?? {};
  }

  // -------------------------------------------------------------------------
  // SIGNING
  // -------------------------------------------------------------------------

  /** Sign an fs mutation: `content` is hashed, its text retained (bounded). */
  commitFile(ref: string, content: string, meta?: Record<string, unknown>): MerkleEntry {
    return this.commit('fs', ref, sha256(content), { content }, meta);
  }

  /** Sign a db state transition: value is recorded via JSON canonicalization. */
  commitState(ref: string, value: unknown, meta?: Record<string, unknown>): MerkleEntry {
    const canonical = JSON.stringify(value);
    return this.commit('db', ref, sha256(canonical), { value }, meta);
  }

  /** Sign an arbitrary event execution (no state, meta only). */
  commitEvent(kind: string, meta?: Record<string, unknown>): MerkleEntry {
    const ref = `__event:${kind}:${this.seq + 1}`;
    const payload = JSON.stringify(meta ?? {});
    return this.commit('db', ref, sha256(payload), { value: meta ?? {} }, { kind, ...meta });
  }

  /** Core append: bump seq, update live state + history, compute new root. */
  private commit(
    kind: AuditSurface,
    ref: string,
    hash: string,
    payload: { value?: unknown; content?: string },
    meta?: Record<string, unknown>
  ): MerkleEntry {
    const prev = this.live.get(ref);
    const version = (prev?.version ?? 0) + 1;
    const prevRoot = this.root; // root BEFORE this mutation — chains the ledger
    this.live.set(ref, { hash, version, kind });

    const hist = this.history.get(ref) ?? { ref, kind, versions: [] };
    hist.versions.push({ version, hash, seq: this.seq + 1, content: payload.content ?? null, value: payload.value });
    if (hist.versions.length > this.maxContentVersions) {
      hist.versions = hist.versions.slice(-this.maxContentVersions);
    }
    this.history.set(ref, hist);

    const entry: MerkleEntry = {
      seq: ++this.seq,
      ref,
      hash,
      version,
      kind,
      prevRoot,
      root: this.computeRoot(this.live),
      timestamp: Date.now(),
      meta,
    };
    this.journal.push(entry);
    if (this.journal.length > this.maxJournal) {
      this.journal = this.journal.slice(-this.maxJournal);
    }
    return entry;
  }

  // -------------------------------------------------------------------------
  // TREE + VERIFICATION
  // -------------------------------------------------------------------------

  /** Current root (GENESIS_ROOT when nothing has been committed). */
  get root(): string {
    return this.computeRoot(this.live);
  }

  /** Recompute the merkle root from a leaf state map. Pure + deterministic. */
  private computeRoot(leaves: Map<string, { hash: string; version: number; kind: AuditSurface }>): string {
    const sorted = Array.from(leaves.entries())
      .map(([ref, leaf]) => sha256(`${ref}:${leaf.version}:${leaf.hash}`))
      .sort();
    return this.buildTree(sorted);
  }

  private buildTree(level: string[]): string {
    if (level.length === 0) return GENESIS_ROOT;
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 < level.length) next.push(hashPair(level[i], level[i + 1]));
        else next.push(level[i]); // odd node bubbles up unchanged
      }
      level = next;
    }
    return level[0];
  }

  /** Verify that `root` is the root implied by the journal's live state. */
  verify(root: string = this.root): boolean {
    return this.computeRoot(this.live) === root;
  }

  /** Verify the whole chain: every entry's prevRoot equals the prior root. */
  verifyChain(): boolean {
    for (let i = 0; i < this.journal.length; i++) {
      const entry = this.journal[i];
      const expectedPrev = i === 0 ? GENESIS_ROOT : this.journal[i - 1].root;
      if (entry.prevRoot !== expectedPrev) return false;
      if (entry.seq !== i + 1) return false;
    }
    return this.verify();
  }

  /**
   * Full cryptographic ledger verification: replay the journal from genesis
   * and recompute the root after EVERY entry, comparing against the recorded
   * root. Catches any tampering of hashes, versions, roots, or ordering — the
   * strongest verification this ledger supports.
   */
  verifyLedger(): boolean {
    const state = new Map<string, { hash: string; version: number; kind: AuditSurface }>();
    let expectedPrev = GENESIS_ROOT;
    for (let i = 0; i < this.journal.length; i++) {
      const entry = this.journal[i];
      if (entry.prevRoot !== expectedPrev) return false;
      if (entry.seq !== i + 1) return false;
      const prev = state.get(entry.ref);
      const replayedVersion = (prev?.version ?? 0) + 1;
      if (replayedVersion !== entry.version) return false;
      state.set(entry.ref, { hash: entry.hash, version: replayedVersion, kind: entry.kind });
      if (this.computeRoot(state) !== entry.root) return false;
      expectedPrev = entry.root;
    }
    return true;
  }

  /** Merkle inclusion proof for a ref against the current root. */
  proof(ref: string): MerkleProof | null {
    const leaf = this.live.get(ref);
    if (!leaf) return null;
    const leafHash = sha256(`${ref}:${leaf.version}:${leaf.hash}`);
    const sorted = Array.from(this.live.entries())
      .map(([r, l]) => ({ ref: r, hash: sha256(`${r}:${l.version}:${l.hash}`) }))
      .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    let index = sorted.findIndex((s) => s.ref === ref);
    if (index === -1) return null;
    let level: Array<{ ref: string; hash: string }> = sorted.map((s) => ({ ref: s.ref, hash: s.hash }));
    const path: MerkleProofStep[] = [];

    while (level.length > 1) {
      const next: Array<{ ref: string; hash: string }> = [];
      let i = 0;
      let nodeIndex = -1;
      while (i < level.length) {
        if (i + 1 < level.length) {
          const left = level[i];
          const right = level[i + 1];
          const parentHash = hashPair(left.hash, right.hash);
          if (i === index) {
            path.push({ sibling: right.hash, position: 'right' });
            nodeIndex = next.length;
          } else if (i + 1 === index) {
            path.push({ sibling: left.hash, position: 'left' });
            nodeIndex = next.length;
          }
          next.push({ ref: `p${next.length}`, hash: parentHash });
          i += 2;
        } else {
          if (i === index) nodeIndex = next.length;
          next.push(level[i]);
          i += 1;
        }
      }
      level = next;
      index = nodeIndex;
    }
    return { ref, hash: leaf.hash, leafHash, root: level[0]?.hash ?? GENESIS_ROOT, path };
  }

  /** Verify a proof by replaying the sibling path from the tree-level leaf
   *  hash — must arrive at the signed root. */
  static verifyProof(proof: MerkleProof): boolean {
    let hash = proof.leafHash;
    for (const step of proof.path) {
      hash = step.position === 'left' ? hashPair(step.sibling, hash) : hashPair(hash, step.sibling);
    }
    return hash === proof.root;
  }

  // -------------------------------------------------------------------------
  // CRYPTOGRAPHIC ROLLBACK
  // -------------------------------------------------------------------------

  /**
   * Restore fs + db state to the snapshot implied by `targetRoot`.
   *   - finds the journal entry whose root equals targetRoot
   *   - replays the journal up to that seq to derive the target state
   *   - diffs against the CURRENT state, producing restore ops
   *   - applies them through the injected appliers (atomic when the applier
   *     wraps the Phase 6 TransactionalPatcher)
   */
  async rollbackToMerkleRoot(targetRoot: string): Promise<RollbackResult> {
    const errors: string[] = [];
    if (targetRoot === GENESIS_ROOT) {
      return this.restoreToState(targetRoot, new Map(), errors);
    }
    const entry = this.findEntryByRoot(targetRoot);
    if (!entry) {
      return { ok: false, targetRoot, ops: [], applied: 0, errors: [`no journal entry carries root ${targetRoot}`] };
    }
    const targetState = this.replayUpTo(entry.seq);
    return this.restoreToState(targetRoot, targetState, errors);
  }

  /** Diff current vs target and apply through the appliers. */
  private async restoreToState(
    targetRoot: string,
    target: Map<string, { hash: string; version: number; kind: AuditSurface; seq: number }>,
    errors: string[]
  ): Promise<RollbackResult> {
    const ops: RestoreOp[] = [];
    const refs = new Set([...this.live.keys(), ...target.keys()]);
    for (const ref of Array.from(refs).sort()) {
      const current = this.live.get(ref);
      const want = target.get(ref);
      const currentHash = current?.hash ?? '';
      const targetHash = want?.hash ?? '';
      if (currentHash === targetHash && (current?.version ?? 0) === (want?.version ?? 0)) continue;
      const hist = this.history.get(ref);
      const versionEntry = want ? hist?.versions.find((v) => v.version === want.version && v.seq === want.seq) : undefined;
      const op: RestoreOp = {
        ref,
        kind: (want?.kind ?? current?.kind) as AuditSurface,
        currentHash,
        targetHash,
        delete: want === undefined,
        content: versionEntry?.content ?? null,
        value: versionEntry?.value,
        available: want ? versionEntry !== undefined : true, // deleting to genesis is always available
      };
      ops.push(op);
    }
    if (ops.some((o) => !o.available)) {
      errors.push('some restore ops are unavailable (content versions evicted)');
    }
    if (errors.length > 0) {
      return { ok: false, targetRoot, ops, applied: 0, errors };
    }

    // Apply in deterministic (sorted-ref) order; a failure stops the restore.
    let applied = 0;
    for (const op of ops) {
      try {
        if (op.kind === 'fs') {
          if (op.content === null && !op.delete) throw new Error(`fs restore for ${op.ref} has no content`);
          if (this.appliers.fs) await this.appliers.fs(op);
        } else {
          if (this.appliers.db) await this.appliers.db(op);
        }
        applied++;
      } catch (error) {
        errors.push(`restore ${op.ref} failed: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
    return { ok: errors.length === 0, targetRoot, ops, applied, errors };
  }

  /** Rebuild the state as of a journal seq (replay in seq order — LWW per ref). */
  private replayUpTo(seq: number): Map<string, { hash: string; version: number; kind: AuditSurface; seq: number }> {
    const state = new Map<string, { hash: string; version: number; kind: AuditSurface; seq: number }>();
    for (const entry of this.journal) {
      if (entry.seq > seq) break;
      state.set(entry.ref, { hash: entry.hash, version: entry.version, kind: entry.kind, seq: entry.seq });
    }
    return state;
  }

  private findEntryByRoot(root: string): MerkleEntry | undefined {
    for (let i = this.journal.length - 1; i >= 0; i--) {
      if (this.journal[i].root === root) return this.journal[i];
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  get seqValue(): number {
    return this.seq;
  }

  get entryCount(): number {
    return this.journal.length;
  }

  get liveRefCount(): number {
    return this.live.size;
  }

  entries(): readonly MerkleEntry[] {
    return this.journal.map((e) => ({ ...e }));
  }

  /** Current live leaf state (read-only snapshot). */
  snapshot(): Map<string, AuditLeaf> {
    const out = new Map<string, AuditLeaf>();
    for (const [ref, leaf] of this.live) {
      out.set(ref, { ref, hash: leaf.hash, version: leaf.version, kind: leaf.kind });
    }
    return out;
  }
}

export default MerkleAudit;
