/**
 * =============================================================================
 * KLYN AI OS — 2.body — Transactional Multi-File Patcher (Phase 6)
 * File: 2.body/transactional_patcher.ts
 *
 * A virtual overlay engine: every FileOperation is validated and applied
 * IN MEMORY against an overlay of per-file content. Nothing touches disk
 * until `commit()`, which flushes all touched files atomically (temp file +
 * rename). `rollback()` replays the plan's inverse operations over the
 * overlay — zero-cost, no disk round-trips.
 *
 * Pipeline:
 *   tx = patcher.begin()
 *   patcher.apply(tx, opA); patcher.apply(tx, opB); ...   // overlay only
 *   patcher.commit(tx)      // one disk flush phase
 *   // or: patcher.rollback(tx)  // pure in-memory inverse replay
 * =============================================================================
 */
import { readFile, writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FileOperation } from '../1.brain/patch_generator.js';

interface VirtualFile {
  path: string;
  base: string;
  /** Ordered edits; current content = base + ops applied sequentially. */
  edits: FileOperation[];
  deleted: boolean;
}

export interface OverlaySnapshot {
  path: string;
  /** Current virtual content (null when the file is deleted in overlay). */
  content: string | null;
  deleted: boolean;
}

export interface Transaction {
  id: string;
  operations: FileOperation[];
  status: 'open' | 'committed' | 'rolled_back' | 'aborted';
  createdAt: number;
}

export interface TransactionResult {
  success: boolean;
  txId: string;
  status: Transaction['status'];
  filesWritten: string[];
  errors: string[];
}

/** In-memory multi-file edit overlay. */
export class VirtualOverlay {
  private files = new Map<string, VirtualFile>();

  /** Current (virtual) content for a path, or null if absent/deleted. */
  get(path: string): string | null {
    const vf = this.files.get(path);
    if (!vf) return null;
    let content = vf.base;
    for (const edit of vf.edits) {
      if (edit.type === 'create') {
        content = edit.content;
      } else if (edit.type === 'modify') {
        if (content !== edit.oldContent) {
          throw new Error(`Modify conflict on ${path}: overlay content drifted from oldContent`);
        }
        content = edit.newContent;
      } else {
        content = '';
      }
    }
    return vf.deleted ? null : content;
  }

  has(path: string): boolean {
    const vf = this.files.get(path);
    return vf !== undefined && !vf.deleted;
  }

  /**
   * Validate + apply one operation against the overlay. The only disk I/O is
   * a one-time baseline read for the first modify/delete on a file that has
   * not been touched yet in this transaction (the common case).
   */
  async apply(op: FileOperation): Promise<void> {
    const existing = this.files.get(op.path);
    switch (op.type) {
      case 'create': {
        if (existing && !existing.deleted) {
          throw new Error(`Cannot create ${op.path}: already exists in overlay`);
        }
        this.files.set(op.path, { path: op.path, base: op.content, edits: [], deleted: false });
        break;
      }
      case 'modify':
      case 'delete': {
        let vf = existing;
        if (!vf) {
          // Hydrate the baseline from disk so untouched files are editable.
          const baseline = await readFile(op.path, 'utf-8').catch(() => null);
          if (baseline === null) {
            throw new Error(`Cannot ${op.type} ${op.path}: file not found`);
          }
          vf = { path: op.path, base: baseline, edits: [], deleted: false };
          this.files.set(op.path, vf);
        }
        const current = vf.deleted ? null : this.get(op.path);
        if (current === null) throw new Error(`Cannot ${op.type} ${op.path}: not present in overlay`);
        if (current !== op.oldContent) {
          throw new Error(`${op.type === 'modify' ? 'Modify' : 'Delete'} conflict on ${op.path}: content drifted from expected oldContent`);
        }
        if (op.type === 'modify') {
          vf.edits.push(op);
        } else {
          vf.deleted = true;
        }
        break;
      }
    }
  }

  /** Snapshot of every tracked file for a transaction flush. */
  snapshot(paths: string[]): OverlaySnapshot[] {
    const out: OverlaySnapshot[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      const vf = this.files.get(path);
      if (!vf) continue;
      out.push({ path, content: vf.deleted ? null : this.get(path), deleted: vf.deleted });
    }
    return out;
  }

  /** Drop committed/rolled-back state for the given paths. */
  release(paths: string[]): void {
    for (const path of paths) this.files.delete(path);
  }

  clear(): void {
    this.files.clear();
  }

  get size(): number {
    return this.files.size;
  }
}

/** Transactional patcher: begin/apply/commit/rollback over a VirtualOverlay. */
export class TransactionalPatcher {
  private overlay = new VirtualOverlay();
  private txs = new Map<string, Transaction>();
  private committedCount = 0;

  /** Open a new transaction (returns its id). */
  begin(): string {
    const id = randomUUID();
    this.txs.set(id, { id, operations: [], status: 'open', createdAt: Date.now() });
    return id;
  }

  /** Validate + apply an operation to the open transaction's overlay. */
  async apply(txId: string, op: FileOperation): Promise<void> {
    const tx = this.txs.get(txId);
    if (!tx) throw new Error(`Unknown transaction: ${txId}`);
    if (tx.status !== 'open') throw new Error(`Transaction ${txId} is ${tx.status}`);
    await this.overlay.apply(op);
    tx.operations.push(op);
  }

  /**
   * Flush every overlay change to disk. Each file is written to a temp path
   * and atomically renamed; a failure rolls the overlay back with the inverse
   * ops so nothing is left half-written.
   */
  async commit(txId: string): Promise<TransactionResult> {
    const tx = this.txs.get(txId);
    if (!tx) {
      return { success: false, txId, status: 'aborted', filesWritten: [], errors: ['Unknown transaction'] };
    }
    if (tx.status !== 'open') {
      return { success: false, txId, status: tx.status, filesWritten: [], errors: [`Transaction is ${tx.status}`] };
    }

    const ops = tx.operations;
    const paths = Array.from(new Set(ops.map((op) => op.path)));
    const filesWritten: string[] = [];
    const errors: string[] = [];

    try {
      for (const snap of this.overlay.snapshot(paths)) {
        if (snap.deleted) {
          await unlink(snap.path).catch(() => undefined);
          filesWritten.push(snap.path);
        } else if (snap.content !== null) {
          await this.atomicWrite(snap.path, snap.content);
          filesWritten.push(snap.path);
        }
      }
      tx.status = 'committed';
      this.committedCount++;
      this.overlay.release(paths);
      this.txs.delete(txId);
      return { success: true, txId, status: 'committed', filesWritten, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      // Best-effort inverse replay over the overlay (no disk writes).
      for (const op of [...ops].reverse().map((o) => this.inverseOf(o))) {
        try {
          await this.overlay.apply(op);
        } catch {
          // ignore — restoring the overlay is best-effort after a flush failure
        }
      }
      tx.status = 'rolled_back';
      return { success: false, txId, status: 'rolled_back', filesWritten, errors };
    }
  }

  /** Zero-cost rollback: replay inverse operations in memory only. */
  async rollback(txId: string): Promise<TransactionResult> {
    const tx = this.txs.get(txId);
    if (!tx) {
      return { success: false, txId, status: 'aborted', filesWritten: [], errors: ['Unknown transaction'] };
    }
    if (tx.status !== 'open') {
      return { success: false, txId, status: tx.status, filesWritten: [], errors: [`Transaction is ${tx.status}`] };
    }

    const inverse = tx.operations.map((op) => this.inverseOf(op)).reverse();
    for (const op of inverse) {
      try {
        await this.overlay.apply(op);
      } catch (error) {
        return {
          success: false,
          txId,
          status: 'rolled_back',
          filesWritten: [],
          errors: [error instanceof Error ? error.message : String(error)],
        };
      }
    }
    tx.status = 'rolled_back';
    this.txs.delete(txId);
    return { success: true, txId, status: 'rolled_back', filesWritten: [], errors: [] };
  }

  /** Abort an open transaction without touching the overlay further. */
  abort(txId: string): void {
    const tx = this.txs.get(txId);
    if (tx && tx.status === 'open') {
      tx.status = 'aborted';
      this.txs.delete(txId);
    }
  }

  get activeCount(): number {
    let open = 0;
    for (const tx of this.txs.values()) if (tx.status === 'open') open++;
    return open;
  }

  get committed(): number {
    return this.committedCount;
  }

  /** Read-only view of an open transaction. */
  getTransaction(txId: string): Transaction | undefined {
    const tx = this.txs.get(txId);
    return tx ? { ...tx, operations: [...tx.operations] } : undefined;
  }

  /** Read current on-disk content (tooling/tests). */
  static async readOnDisk(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private inverseOf(op: FileOperation): FileOperation {
    switch (op.type) {
      case 'create':
        return { type: 'delete', path: op.path, oldContent: op.content };
      case 'modify':
        return { type: 'modify', path: op.path, oldContent: op.newContent, newContent: op.oldContent };
      case 'delete':
        return { type: 'create', path: op.path, content: op.oldContent };
    }
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${randomUUID().slice(0, 8)}`;
    try {
      await writeFile(tmp, content, 'utf-8');
      await rename(tmp, path);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }
}

export default TransactionalPatcher;
