// =============================================================================
// KLYN AI OS — deploy — Deployable Artifact Engine (Phase 14)
// File: packages/deploy/src/artifact.ts
//
// Phase 14 capability #4 (artifact half). Turns the OS into a deployable
// artifact: discovers the production entrypoint, produces a single-file
// `bun build --compile` plan, builds a tamper-evident SHA-256 manifest, and
// verifies that the plan still matches the tree on disk (a changed entry or
// dependency pin invalidates the manifest — no stale binaries):
//
//   const plan = await ArtifactEngine.buildPlan(repoRoot);
//   // plan = {
//   //   entry: 'klyn_server.js', outfile: 'dist/klyn', target: 'bun',
//   //   flags: ['--compile', '--minify', '--sourcemap'],
//   //   manifest: [{ path: 'klyn_server.js', sha256: '...' }, ...],
//   //   deps: { 'express': '^5.2.1', ... },
//   //   verified: true, errors: [],
//   // }
//   const stillValid = await ArtifactEngine.verifyPlan(plan, repoRoot);
//
//   const compileCommand = ArtifactEngine.compileCommand(plan);
//   // → "bun build ./klyn_server.js --compile --minify --outfile dist/klyn"
//
// The engine never executes the build itself — it produces + validates the
// plan (deterministic, safe to run in CI and smoke suites). Operators run
// the returned command to produce the actual single binary.
// =============================================================================
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export interface ArtifactManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ArtifactPlan {
  entry: string;
  outfile: string;
  target: 'bun' | 'node';
  flags: string[];
  externals: string[];
  manifest: ArtifactManifestEntry[];
  deps: Record<string, string>;
  verified: boolean;
  errors: string[];
  generatedAt: number;
}

export interface ArtifactEngineOptions {
  entry?: string;
  outfile?: string;
  target?: 'bun' | 'node';
  flags?: string[];
  externals?: string[];
  /** Extra manifest paths (beyond entry + package.json). */
  extraManifestPaths?: string[];
}

const DEFAULT_FLAGS = ['--compile', '--minify', '--sourcemap'];
const DEFAULT_EXTERNALS = ['bun:sqlite'];

function sha256Of(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function fileEntry(absPath: string, root: string): Promise<ArtifactManifestEntry | null> {
  const content = await readFile(absPath);
  return { path: relative(root, absPath).split('\\').join('/'), sha256: sha256Of(content), bytes: content.length };
}

export class ArtifactEngine {
  /** Discover the production entrypoint: klyn_server.js (unified gateway) or
   *  klyn_cli.js (headless CLI). Throws when neither exists. */
  static resolveEntry(repoRoot: string, entry?: string): string {
    if (entry) {
      const abs = resolve(repoRoot, entry);
      if (!existsSync(abs)) throw new Error(`ArtifactEngine: entry ${entry} not found`);
      return entry;
    }
    if (existsSync(join(repoRoot, 'klyn_server.js'))) return 'klyn_server.js';
    if (existsSync(join(repoRoot, 'klyn_cli.js'))) return 'klyn_cli.js';
    throw new Error('ArtifactEngine: no production entrypoint (klyn_server.js / klyn_cli.js) found');
  }

  /** Build the full artifact plan for a repo root. Deterministic except for
   *  generatedAt. */
  static async buildPlan(repoRoot: string, options: ArtifactEngineOptions = {}): Promise<ArtifactPlan> {
    const errors: string[] = [];
    const entry = ArtifactEngine.resolveEntry(repoRoot, options.entry);
    const outfile = options.outfile ?? join('dist', 'klyn');
    const target = options.target ?? 'bun';
    const flags = options.flags ?? DEFAULT_FLAGS;
    const externals = options.externals ?? DEFAULT_EXTERNALS;

    const manifestPaths = [entry, 'package.json', ...(options.extraManifestPaths ?? [])];
    const manifest: ArtifactManifestEntry[] = [];
    for (const rel of manifestPaths) {
      const abs = join(repoRoot, rel);
      if (!existsSync(abs)) {
        errors.push(`manifest path missing: ${rel}`);
        continue;
      }
      const entry = await fileEntry(abs, repoRoot);
      if (entry) manifest.push(entry);
    }

    let deps: Record<string, string> = {};
    try {
      const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf-8')) as { dependencies?: Record<string, string> };
      deps = { ...(pkg.dependencies ?? {}) };
    } catch (error) {
      errors.push(`package.json unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Validate that the entry's static imports resolve (a plan whose imports
    // are missing would fail at compile time — catch it before building).
    const unresolved = await ArtifactEngine.findUnresolvedImports(repoRoot, entry);
    for (const imp of unresolved) errors.push(`entry import unresolved: ${imp}`);

    return {
      entry,
      outfile,
      target,
      flags,
      externals,
      manifest,
      deps,
      verified: errors.length === 0,
      errors,
      generatedAt: Date.now(),
    };
  }

  /** Re-verify a plan against the current tree: every manifest file must
   *  hash identically and package.json deps must be unchanged. */
  static async verifyPlan(plan: ArtifactPlan, repoRoot: string): Promise<boolean> {
    for (const entry of plan.manifest) {
      const abs = join(repoRoot, entry.path);
      const rehashed = await fileEntry(abs, repoRoot);
      if (!rehashed || rehashed.sha256 !== entry.sha256) return false;
    }
    try {
      const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf-8')) as { dependencies?: Record<string, string> };
      const current = { ...(pkg.dependencies ?? {}) };
      for (const [name, version] of Object.entries(plan.deps)) {
        if (current[name] !== version) return false;
      }
    } catch {
      return false;
    }
    return true;
  }

  /** The exact shell command an operator runs to produce the single binary. */
  static compileCommand(plan: ArtifactPlan): string {
    const flagStr = plan.flags.filter((f) => f !== '--outfile').join(' ');
    const externals = plan.externals.map((e) => `--external "${e}"`).join(' ');
    return `bun build ./${plan.entry} ${flagStr} ${externals} --outfile ${plan.outfile}`;
  }

  /** Walk the entry's static `import`/`require` specifiers and report any
   *  that resolve to neither a local file nor an installed package. */
  static async findUnresolvedImports(repoRoot: string, entry: string): Promise<string[]> {
    const unresolved: string[] = [];
    const entryAbs = resolve(repoRoot, entry);
    const content = await readFile(entryAbs, 'utf-8').catch(() => '');
    const imports = ArtifactEngine.extractImportSpecifiers(content);
    for (const spec of imports) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        // relative — must exist on disk (try exact, .js, and /index.js)
        const candidates = [
          resolve(dirname(entryAbs), spec),
          resolve(dirname(entryAbs), `${spec}.js`),
          resolve(dirname(entryAbs), spec, 'index.js'),
        ];
        if (!candidates.some((c) => existsSync(c))) unresolved.push(spec);
      } else {
        // bare package — must exist in node_modules
        const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        const pkgRoot = resolve(repoRoot, 'node_modules', pkgName);
        if (!existsSync(pkgRoot) && !spec.startsWith('node:') && !spec.startsWith('bun:')) unresolved.push(spec);
      }
    }
    return unresolved;
  }

  /** Extract static import/require specifiers (ESM + CJS, single-line). */
  static extractImportSpecifiers(content: string): string[] {
    const specs: string[] = [];
    for (const m of content.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      specs.push(m[1]);
    }
    for (const m of content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      specs.push(m[1]);
    }
    return Array.from(new Set(specs));
  }

  /** Recursively list every file under `dir` (excluding node_modules/.git). */
  static async listTree(repoRoot: string, dir = repoRoot, base = ''): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await ArtifactEngine.listTree(repoRoot, abs, rel)));
      } else if (entry.isFile()) {
        const info = await stat(abs);
        if (info.size > 0) out.push(rel);
      }
    }
    return out;
  }
}

export default ArtifactEngine;
