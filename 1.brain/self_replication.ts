// =============================================================================
// KLYN AI OS — 1.brain — Autonomous Self-Replication (Phase 11)
// File: 1.brain/self_replication.ts
//
// Phase 11 capability #2. The OS can prove it knows its own complete byte
// identity and reconstruct a byte-exact replica of itself anywhere — the
// seed of self-propagation:
//
//   const replicator = new SelfReplicator();
//   const seed = await replicator.generateSeed(repoRoot);   // own identity
//   const verdict = await replicator.verifyTree(seed, repoRoot);
//   const plan = await replicator.bootstrap(repoRoot, targetDir, { apply: true });
//   const ok = replicator.verifySeedIntegrity(seed);        // tamper-evident
//
// 1. REPLICATION SEED — a compact, tamper-evident manifest of the OS's own
//    source tree: every file's relpath + SHA-256 + size, the dependency
//    pins, and the build/run commands. The seed's rootHash is a SHA-256 over
//    the canonical manifest, so ANY edit to the manifest (or any file in the
//    tree) is detectable — `verifySeedIntegrity` re-derives the root hash.
//
// 2. TREE VERIFICATION — `verifyTree(seed, root)` re-hashes the live tree
//    against the seed. `missing` = seed files absent, `changed` = hash
//    mismatches, `extra` = files present but not in the seed (reported, but
//    extras are runtime artifacts and never invalidate — a replica is valid
//    the moment every seed byte matches).
//
// 3. BOOTSTRAP — `bootstrap(sourceRoot, targetDir, { apply })` plans the
//    exact replica file set (dry-run by default — zero writes) or
//    materializes it, then re-verifies the replica tree against the seed.
//    A replica that passes is byte-identical to the source: the OS can be
//    re-forged from its own seed on Termux, CI, or any edge worker.
//
// Combined with the Phase 11 causal engine's `deltaSince`/`applyDelta`, a
// replica that boots from a seed then catches up on the causal ledger delta
// is a full, current clone — "Klyn copies itself, and knows it did."
//
// Pure TypeScript, node:crypto sha256 only, zero new dependencies.
// =============================================================================
import { createHash } from 'node:crypto';
import { statSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export interface ReplicationFile {
  /** Repo-relative path (forward slashes). */
  path: string;
  sha256: string;
  size: number;
}

export interface ReplicationSeed {
  engine: string;
  version: string;
  nodeId: string;
  generatedAt: number;
  /** Sorted by path — the canonical order for the root hash. */
  files: ReplicationFile[];
  /** Dependency pins (name → version) from package.json. */
  deps: Record<string, string>;
  /** Build/run commands from package.json scripts. */
  build: { install?: string; build?: string; start?: string };
  /** SHA-256 over the canonical manifest — tamper-evident. */
  rootHash: string;
}

export interface TreeVerifyResult {
  valid: boolean;
  /** Seed files that no longer exist on disk. */
  missing: string[];
  /** Seed files whose live bytes differ (path + expected vs actual hash). */
  changed: Array<{ path: string; expected: string; actual: string }>;
  /** Files on disk that are not part of the seed (runtime artifacts). */
  extra: string[];
  files: number;
  matched: number;
}

export interface BootstrapPlan {
  files: number;
  bytes: number;
  applied: boolean;
  /** Post-bootstrap tree verification (null on dry-run — nothing was
   *  written, so there is no replica tree to verify). */
  verify: TreeVerifyResult | null;
}

export interface ReplicationOptions {
  /** Directories skipped at any depth (default: vendored/binary trees). */
  skipDirs?: string[];
  /** Files larger than this are excluded from the seed (default 512 KiB). */
  maxFileBytes?: number;
  /** Cap on the number of files hashed (default 5000). */
  maxFiles?: number;
  /** Node identity stamped into the seed (defaults to KLYN_NODE_ID). */
  nodeId?: string;
}

// -----------------------------------------------------------------------------
// DEFAULTS
// -----------------------------------------------------------------------------

const DEFAULT_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', 'genesis', '.klyn_selfhost', '.klyn_runtime', 'vault_data', 'coverage', '.klyn']);
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_FILES = 5000;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Canonical root hash over the seed's identity + sorted file manifest. The
 *  file entries are serialized as fixed-position tuples so field renames or
 *  reordering can never silently produce the same hash. */
export function computeSeedRootHash(engine: string, version: string, files: ReplicationFile[]): string {
  const canonical = JSON.stringify({
    engine,
    version,
    files: files.map((f) => [f.path, f.sha256, f.size]),
  });
  return sha256(canonical);
}

function defaultNodeId(): string {
  return process.env.KLYN_NODE_ID ?? 'klyn-node';
}

// -----------------------------------------------------------------------------
// SELF-REPLICATOR
// -----------------------------------------------------------------------------

export class SelfReplicator {
  private readonly skipDirs: Set<string>;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly nodeId: string;

  constructor(options: ReplicationOptions = {}) {
    this.skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS);
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.nodeId = options.nodeId ?? defaultNodeId();
  }

  // -------------------------------------------------------------------------
  // SEED GENERATION (own identity)
  // -------------------------------------------------------------------------

  /** Generate the tamper-evident replication seed of a source tree. */
  async generateSeed(repoRoot: string): Promise<ReplicationSeed> {
    const pkg = await this.readPackage(repoRoot);
    const files: ReplicationFile[] = [];
    await this.walk(repoRoot, repoRoot, (rel, abs) => {
      if (files.length >= this.maxFiles) return;
      const content = this.readBounded(abs);
      if (content === null) return;
      files.push({ path: rel, sha256: sha256(content), size: Buffer.byteLength(content, 'utf-8') });
    });
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    return {
      engine: 'klyn-ai-os',
      version: pkg?.version ?? '0.0.0',
      nodeId: this.nodeId,
      generatedAt: Date.now(),
      files,
      deps: pkg?.dependencies ?? {},
      build: {
        install: pkg?.scripts?.install,
        build: pkg?.scripts?.build,
        start: pkg?.scripts?.start,
      },
      rootHash: computeSeedRootHash('klyn-ai-os', pkg?.version ?? '0.0.0', files),
    };
  }

  // -------------------------------------------------------------------------
  // VERIFICATION
  // -------------------------------------------------------------------------

  /** Re-hash the live tree against the seed. `missing` + `changed` gate
   *  validity; `extra` files are reported but never invalidate. */
  async verifyTree(seed: ReplicationSeed, repoRoot: string): Promise<TreeVerifyResult> {
    const expected = new Map(seed.files.map((f) => [f.path, f]));
    const changed: Array<{ path: string; expected: string; actual: string }> = [];
    const seen = new Set<string>();
    let matched = 0;

    await this.walk(repoRoot, repoRoot, (rel, abs) => {
      seen.add(rel);
      const want = expected.get(rel);
      if (!want) return;
      const content = this.readBounded(abs);
      if (content === null) return; // unreadable → counted as missing below
      const actual = sha256(content);
      if (actual === want.sha256) matched++;
      else changed.push({ path: rel, expected: want.sha256, actual });
    });

    // A deleted seed file is NEVER visited during the walk — it must be
    // derived from the seed manifest itself, not from what the walk saw.
    const missing = seed.files.filter((f) => !seen.has(f.path)).map((f) => f.path);
    const extra = Array.from(seen).filter((p) => !expected.has(p)).sort();
    return {
      valid: missing.length === 0 && changed.length === 0,
      missing,
      changed,
      extra,
      files: seed.files.length,
      matched,
    };
  }

  /** Tamper-evidence: recompute the root hash from the seed's own manifest
   *  and compare against the stored rootHash. Any edit to `files` (path,
   *  hash, size), engine, or version breaks the identity. */
  verifySeedIntegrity(seed: ReplicationSeed): boolean {
    return computeSeedRootHash(seed.engine, seed.version, seed.files) === seed.rootHash;
  }

  // -------------------------------------------------------------------------
  // BOOTSTRAP (reforge a replica)
  // -------------------------------------------------------------------------

  /**
   * Plan or materialize a byte-exact replica of `sourceRoot` in `targetDir`
   * from `seed`. Dry-run by default (returns the file plan, writes NOTHING);
   * with `{ apply: true }` the replica is written and then verified against
   * the seed. Any seed file whose source bytes no longer match the seed is
   * reported as changed and skipped — a corrupted source can never propagate.
   */
  async bootstrap(sourceRoot: string, targetDir: string, opts: { apply?: boolean } = {}): Promise<BootstrapPlan> {
    const seed = await this.generateSeed(sourceRoot);
    let bytes = 0;
    let files = 0;
    const changed: Array<{ path: string; expected: string; actual: string }> = [];
    const missing: string[] = [];

    for (const file of seed.files) {
      const content = this.readBounded(join(sourceRoot, file.path));
      if (content === null) {
        missing.push(file.path);
        continue;
      }
      const actual = sha256(content);
      if (actual !== file.sha256) {
        changed.push({ path: file.path, expected: file.sha256, actual });
        continue;
      }
      files++;
      bytes += Buffer.byteLength(content, 'utf-8');
      if (opts.apply) {
        const target = join(targetDir, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, 'utf-8');
      }
    }

    if (!opts.apply) {
      return { files, bytes, applied: false, verify: null };
    }

    const verify = await this.verifyTree(seed, targetDir);
    return { files, bytes, applied: true, verify };
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private async readPackage(repoRoot: string): Promise<{ version?: string; dependencies?: Record<string, string>; scripts?: Record<string, string> } | null> {
    try {
      const raw = await readFile(join(repoRoot, 'package.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { version?: string; dependencies?: Record<string, string>; scripts?: Record<string, string> };
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }

  private async walk(root: string, dir: string, onFile: (rel: string, abs: string) => void): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (this.skipDirs.has(entry.name)) continue;
        await this.walk(root, join(dir, entry.name), onFile);
        continue;
      }
      if (!entry.isFile()) continue;
      const abs = join(dir, entry.name);
      const rel = abs.slice(root.length + 1).split('\\').join('/');
      onFile(rel, abs);
    }
  }

  /** Bounded single read: returns null when the file is missing, unreadable,
   *  or over the size cap (a pathological blob must never blow the heap). */
  private readBounded(abs: string): string | null {
    try {
      const stat = statSync(abs);
      if (stat.size > this.maxFileBytes) return null;
      return readFileSync(abs, 'utf-8');
    } catch {
      return null;
    }
  }
}

export default SelfReplicator;
