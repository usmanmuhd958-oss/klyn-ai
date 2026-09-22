// =============================================================================
// KLYN AI OS — Incremental Manifest Ledger (Phase 1)
// File: src/indexer/manifest.ts
//
// Content-hash ledger tracking path -> sha256(content) + mtime + size + AST
// fingerprint. `refresh()` is the hot path: it walks the tree doing stat-only
// comparisons first, and only reads + hashes files whose stat changed. On a
// quiescent repo this is O(files) stat calls and ZERO content reads — the
// per-query re-ingest bottleneck lives and dies here.
// =============================================================================

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export interface ManifestEntry {
  /** Path relative to the scan root (forward slashes). */
  path: string;
  /** sha256(content) hex. */
  hash: string;
  size: number;
  mtimeMs: number;
  /** AST structural fingerprint (from symbols.ts) — '' for binary/non-code. */
  fingerprint: string;
}

export interface ManifestDiff {
  added: string[];
  modified: string[];
  removed: string[];
  unchanged: string[];
  scannedFiles: number;
  readFiles: number;
  refreshMs: number;
}

export type FingerprintFn = (content: string, ext: string, relPath: string) => string;

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage',
  '.cache', 'target', '__pycache__', '.venv', 'venv', '.idea', '.vscode',
  'tmp', 'temp', '.migration-backup',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.node',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.pyc', '.class', '.o', '.obj',
]);

export class ManifestLedger {
  private entries = new Map<string, ManifestEntry>();
  private root: string | null = null;

  /**
   * Differential scan. Only files whose (mtime, size) changed are read and
   * re-hashed; everything else rides the stat fast path.
   */
  async refresh(
    rootPath: string,
    fingerprint: FingerprintFn = (_c, _e, _r) => ''
  ): Promise<ManifestDiff> {
    const start = performance.now();
    const seen = new Set<string>();
    const added: string[] = [];
    const modified: string[] = [];
    const unchanged: string[] = [];
    let readFiles = 0;

    for await (const { rel, abs, size, mtimeMs } of this.walk(rootPath)) {
      seen.add(rel);
      const prev = this.entries.get(rel);

      if (prev && prev.mtimeMs === mtimeMs && prev.size === size) {
        // Stat fast path — content assumed unchanged, zero reads.
        unchanged.push(rel);
        continue;
      }

      let content: Buffer;
      try {
        content = await readFile(abs);
      } catch {
        continue; // raced with a delete — the removal pass below handles it
      }
      readFiles++;
      const hash = sha256(content);
      const ext = getExtension(rel);

      if (prev && prev.hash === hash) {
        // Touched (mtime moved) but byte-identical — refresh metadata only.
        prev.mtimeMs = mtimeMs;
        unchanged.push(rel);
        continue;
      }

      const fp = isBinary(ext)
        ? ''
        : fingerprint(content.toString('utf-8'), ext, rel);

      this.entries.set(rel, { path: rel, hash, size, mtimeMs, fingerprint: fp });
      (prev ? modified : added).push(rel);
    }

    const removed: string[] = [];
    for (const [p] of this.entries) {
      if (!seen.has(p)) {
        this.entries.delete(p);
        removed.push(p);
      }
    }

    this.root = rootPath;
    return {
      added,
      modified,
      removed,
      unchanged,
      scannedFiles: seen.size,
      readFiles,
      refreshMs: performance.now() - start,
    };
  }

  get(path: string): ManifestEntry | undefined {
    return this.entries.get(path);
  }

  get rootPath(): string | null {
    return this.root;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Persist the ledger as JSON for cold-start reuse. */
  async saveTo(file: string): Promise<void> {
    const snapshot = {
      root: this.root,
      entries: Array.from(this.entries.values()),
    };
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot), 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(tmp, file);
  }

  /** Load a previously saved ledger. Returns the number of entries loaded. */
  async loadFrom(file: string): Promise<number> {
    try {
      const { readFile: rf } = await import('node:fs/promises');
      const raw = await rf(file, 'utf8');
      const snapshot = JSON.parse(raw) as {
        root: string | null;
        entries: ManifestEntry[];
      };
      this.root = snapshot.root ?? null;
      this.entries.clear();
      for (const e of snapshot.entries) this.entries.set(e.path, e);
      return this.entries.size;
    } catch {
      return 0;
    }
  }

  clear(): void {
    this.entries.clear();
    this.root = null;
  }

  // -------------------------------------------------------------------------
  // PRIVATE
  // -------------------------------------------------------------------------

  private async *walk(
    rootPath: string
  ): AsyncGenerator<{ rel: string; abs: string; size: number; mtimeMs: number }> {
    async function* walkDir(
      dir: string,
      relDir: string
    ): AsyncGenerator<{ rel: string; abs: string; size: number; mtimeMs: number }> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.isDirectory()) continue;

        const abs = join(dir, entry.name);
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          yield* walkDir(abs, rel);
        } else if (entry.isFile()) {
          let st;
          try {
            st = await stat(abs);
          } catch {
            continue;
          }
          if (st.size === 0) continue; // skip empty files
          yield { rel, abs, size: st.size, mtimeMs: st.mtimeMs };
        }
      }
    }
    yield* walkDir(rootPath, '');
  }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  const lastSlash = filename.lastIndexOf(sep);
  if (lastDot > lastSlash && lastDot !== -1) {
    return filename.substring(lastDot).toLowerCase();
  }
  return '';
}

function isBinary(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext);
}

export function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name);
}

export default ManifestLedger;
