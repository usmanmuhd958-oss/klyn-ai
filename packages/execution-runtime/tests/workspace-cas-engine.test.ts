import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceCasEngine, snapshotWorkspace } from "../src/index.ts";

test("CAS commits an isolated shadow and preserves complete changes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-cas-"));
  await writeFile(join(workspace, "a.txt"), "one");
  const cas = new WorkspaceCasEngine();
  const shadow = await cas.createShadow(workspace);
  await writeFile(join(shadow.shadowRoot, "a.txt"), "two");
  await writeFile(join(shadow.shadowRoot, "b.txt"), "three");
  const result = await cas.commit(shadow);
  assert.equal(result.committed, true);
  assert.deepEqual(result.changedPaths, ["a.txt", "b.txt"]);
  assert.equal(await readFile(join(workspace, "a.txt"), "utf8"), "two");
  assert.equal(await readFile(join(workspace, "b.txt"), "utf8"), "three");
});

test("CAS rejects stale workspaces instead of overwriting concurrent changes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-cas-"));
  await writeFile(join(workspace, "a.txt"), "one");
  const cas = new WorkspaceCasEngine();
  const shadow = await cas.createShadow(workspace);
  await writeFile(join(workspace, "a.txt"), "external-change");
  await assert.rejects(() => cas.commit(shadow), /CAS conflict/);
  assert.equal((await snapshotWorkspace(workspace)).digest, (await snapshotWorkspace(workspace)).digest);
});
