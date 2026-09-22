import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ExecutionKernel, ResourceBoundaryEnforcer, type ProcessSandboxManager, type ProcessSandboxResult } from "../src/index.ts";

function fakeProcess(result: Partial<ProcessSandboxResult>): ProcessSandboxManager {
  return {
    execute: async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
      memoryExceeded: false,
      resourceLimitExceeded: false,
      ...result,
    }),
  } as unknown as ProcessSandboxManager;
}

function boundary(workspace: string): ResourceBoundaryEnforcer {
  return new ResourceBoundaryEnforcer({
    maxMemoryMb: 512,
    maxCpuMs: 30_000,
    maxFileDescriptors: 256,
    maxExecutionMs: 30_000,
    authorizedWorkspaces: [workspace],
  });
}

test("ExecutionKernel mutates only the shadow and atomically commits verified output", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-kernel-"));
  const filePath = join(workspace, "module.ts");
  await writeFile(filePath, "export const answer = 1;\n", "utf8");

  const kernel = new ExecutionKernel({
    processManager: fakeProcess({ exitCode: 0 }),
    resourceBoundary: boundary(workspace),
  });
  const result = await kernel.execute({
    executionId: "kernel-commit-test",
    workspace,
    sourcePath: filePath,
    mutations: [{ kind: "rename-identifier", from: "answer", to: "answerValue" }],
    command: "/usr/bin/node",
    args: ["-e", "process.exit(0)"],
    allowedEnv: [],
  });

  assert.equal(result.committed, true);
  assert.equal(result.rolledBack, false);
  assert.equal(result.process.exitCode, 0);
  assert.match(await readFile(filePath, "utf8"), /answerValue/);
});

test("ExecutionKernel discards shadow state when verification fails", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-kernel-"));
  const filePath = join(workspace, "module.ts");
  const original = "export const answer = 1;\n";
  await writeFile(filePath, original, "utf8");

  const kernel = new ExecutionKernel({
    processManager: fakeProcess({ exitCode: 1 }),
    resourceBoundary: boundary(workspace),
  });
  const result = await kernel.execute({
    executionId: "kernel-rollback-test",
    workspace,
    sourcePath: filePath,
    mutations: [{ kind: "rename-identifier", from: "answer", to: "answerValue" }],
    command: "/usr/bin/node",
    args: ["-e", "process.exit(1)"],
    allowedEnv: [],
  });

  assert.equal(result.committed, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.process.exitCode, 1);
  assert.equal(await readFile(filePath, "utf8"), original);
});
