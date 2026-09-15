import { cp, mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RuntimeSnapshot {
  readonly id: string;
  readonly workspace: string;
  readonly snapshotPath: string;
}

export class RuntimeSnapshotEngine {
  async create(workspace: string): Promise<RuntimeSnapshot> {
    const root = await mkdtemp(join(tmpdir(), "klyn-snapshot-"));
    const snapshotPath = join(root, "workspace");
    await cp(workspace, snapshotPath, { recursive: true, force: true, errorOnExist: false });
    return { id: root.split("/").pop() ?? root, workspace, snapshotPath };
  }

  async rollback(snapshot: RuntimeSnapshot): Promise<void> {
    const restorePath = `${snapshot.workspace}.klyn-restore-${Date.now()}`;
    await cp(snapshot.snapshotPath, restorePath, { recursive: true, force: true, errorOnExist: false });
    const displacedPath = `${snapshot.workspace}.klyn-displaced-${Date.now()}`;
    await rename(snapshot.workspace, displacedPath);
    try {
      await rename(restorePath, snapshot.workspace);
    } catch (error) {
      await rename(displacedPath, snapshot.workspace).catch(() => undefined);
      await rm(restorePath, { recursive: true, force: true });
      throw error;
    }
    await rm(displacedPath, { recursive: true, force: true });
  }

  async discard(snapshot: RuntimeSnapshot): Promise<void> {
    await rm(snapshot.snapshotPath, { recursive: true, force: true });
    await rm(join(tmpdir(), `klyn-snapshot-${snapshot.id}`), { recursive: true, force: true });
  }
}
