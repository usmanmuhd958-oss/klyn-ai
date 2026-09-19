import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ExecutionKernel } from "../src/index.ts";

const processEnv = {
  PATH: process.env.PATH ?? "",
};

test("ExecutionKernel commits a verified AST mutation", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-kernel-"));
  const filePath = join(workspace, "module.mjs");
  await writeFile(filePath, "export const answer = 1;\n", "utf8");

  const kernel = new ExecutionKernel();
  const result = await kernel.execute({
    executionId: "kernel-commit-test",
    workspace,
    sourcePath: filePath,
    mutations: [{ kind: "rename-identifier", from: "answer", to: "answerValue" }],
    command: "node",
    args: ["-e", "import('./module.mjs').then(m => { if (m.answerValue !== 1) process.exit(2); })"],
    env: processEnv,
    allowedEnv: ["PATH"],
  });

  assert.equal(result.committed, true);
  assert.equal(result.rolledBack, false);
  assert.equal(result.process.exitCode, 0);
  assert.match(await readFile(filePath, "utf8"), /answerValue/);
});

test("ExecutionKernel rolls back a mutation when verification fails", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-kernel-"));
  const filePath = join(workspace, "module.mjs");
  const original = "export const answer = 1;\n";
  await writeFile(filePath, original, "utf8");

  const kernel = new ExecutionKernel();
  const result = await kernel.execute({
    executionId: "kernel-rollback-test",
    workspace,
    sourcePath: filePath,
    mutations: [{ kind: "rename-identifier", from: "answer", to: "answerValue" }],
    command: "node",
    args: ["-e", "process.exit(1)"],
    env: processEnv,
    allowedEnv: ["PATH"],
  });

  assert.equal(result.committed, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.process.exitCode, 1);
  assert.equal(await readFile(filePath, "utf8"), original);
});
