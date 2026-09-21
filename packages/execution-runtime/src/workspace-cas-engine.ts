import { createHash } from "node:crypto";
import { cp, lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export interface WorkspaceEntry {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly digest: string;
  readonly size: number;
}

export interface WorkspaceRevision {
  readonly root: string;
  readonly digest: string;
  readonly entries: readonly WorkspaceEntry[];
}

export interface ShadowWorkspace {
  readonly id: string;
  readonly sourceRoot: string;
  readonly shadowRoot: string;
  readonly baseRevision: WorkspaceRevision;
}

export interface CommitResult {
  readonly committed: boolean;
  readonly revision: WorkspaceRevision;
  readonly changedPaths: readonly string[];
}

function hash(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function digestEntry(root: string, rel: string): Promise<WorkspaceEntry> {
  const abs = resolve(root, rel);
  const st = await lstat(abs);
  if (st.isSymbolicLink()) {
    const target = await readFile(abs, "utf8").catch(() => "");
    return { path: rel, kind: "symlink", digest: hash(target), size: st.size };
  }
  if (st.isDirectory()) return { path: rel, kind: "directory", digest: hash("dir"), size: 0 };
  if (st.isFile()) {
    const data = await readFile(abs);
    return { path: rel, kind: "file", digest: hash(data), size: data.byteLength };
  }
  throw new Error(`Unsupported filesystem object: ${rel}`);
}

export async function snapshotWorkspace(root: string): Promise<WorkspaceRevision> {
  const canonical = resolve(root);
  const entries: WorkspaceEntry[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const names = await readdir(dir, { withFileTypes: true });
    names.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of names) {
      if (entry.name === ".klyn-cas-lock") continue;
      const rel = prefix ? join(prefix, entry.name) : entry.name;
      const info = await digestEntry(canonical, rel);
      entries.push(info);
      if (info.kind === "directory") await walk(resolve(canonical, rel), rel);
    }
  };
  await walk(canonical, "");
  const digest = hash(entries.map((e) => `${e.path}\0${e.kind}\0${e.digest}\0${e.size}`).join("\n"));
  return Object.freeze({ root: canonical, digest, entries: Object.freeze(entries) });
}

function changedPaths(before: WorkspaceRevision, after: WorkspaceRevision): string[] {
  const a = new Map(before.entries.map((e) => [e.path, e]));
  const b = new Map(after.entries.map((e) => [e.path, e]));
  const paths = new Set<string>();
  for (const [p, x] of a) {
    const y = b.get(p);
    if (!y || x.kind !== y.kind || x.digest !== y.digest || x.size !== y.size) paths.add(p);
  }
  for (const p of b.keys()) if (!a.has(p)) paths.add(p);
  return [...paths].sort();
}

async function acquireLock(root: string): Promise<() => Promise<void>> {
  const lock = join(dirname(root), `.${basename(root)}.klyn-cas-lock`);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, "owner"), `${process.pid}\n`);
      return async () => { await rm(lock, { recursive: true, force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = Number.parseInt(await readFile(join(lock, "owner"), "utf8"), 10);
        if (Number.isInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); } catch { await rm(lock, { recursive: true, force: true }); continue; }
        }
      } catch { /* owner may be mid-write; retry */ }
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  throw new Error("workspace CAS lock acquisition timed out");
}

export class WorkspaceCasEngine {
  async createShadow(root: string): Promise<ShadowWorkspace> {
    const baseRevision = await snapshotWorkspace(root);
    const id = `klyn-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
    const shadowRoot = join(dirname(baseRevision.root), `.klyn-shadow-${basename(baseRevision.root)}-${id}`);
    await cp(baseRevision.root, shadowRoot, { recursive: true, force: true, errorOnExist: false, dereference: false });
    return Object.freeze({ id, sourceRoot: baseRevision.root, shadowRoot, baseRevision });
  }

  async commit(shadow: ShadowWorkspace): Promise<CommitResult> {
    const release = await acquireLock(shadow.sourceRoot);
    try {
      const current = await snapshotWorkspace(shadow.sourceRoot);
      if (current.digest !== shadow.baseRevision.digest) {
        throw new Error(`CAS conflict: workspace changed from ${shadow.baseRevision.digest} to ${current.digest}`);
      }
      const after = await snapshotWorkspace(shadow.shadowRoot);
      const changed = changedPaths(current, after);

      const backup = `${shadow.sourceRoot}.klyn-backup-${shadow.id}`;
      await rename(shadow.sourceRoot, backup);
      try {
        await rename(shadow.shadowRoot, shadow.sourceRoot);
      } catch (error) {
        await rename(backup, shadow.sourceRoot).catch(() => undefined);
        throw error;
      }
      await rm(backup, { recursive: true, force: true });
      const committed = await snapshotWorkspace(shadow.sourceRoot);
      return Object.freeze({ committed: true, revision: committed, changedPaths: Object.freeze(changed) });
    } finally {
      await release();
    }
  }

  async discard(shadow: ShadowWorkspace): Promise<void> {
    await rm(shadow.shadowRoot, { recursive: true, force: true });
  }
}
