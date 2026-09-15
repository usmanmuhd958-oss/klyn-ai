import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  EphemeralSandboxRuntime,
  ResourceBoundaryEnforcer,
  ResourceBoundaryViolation,
  RuntimeSnapshotEngine,
} from "../../../packages/execution-runtime/src/index.ts";

test("Phase 8.6 rejects memory budgets above the runtime policy", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-p86-memory-"));
  try {
    const runtime = new EphemeralSandboxRuntime({
      resourcePolicy: {
        maxMemoryMb: 64,
        maxCpuMs: 5_000,
        maxFileDescriptors: 64,
        maxExecutionMs: 5_000,
        authorizedWorkspaces: [workspace],
      },
    });
    await assert.rejects(
      runtime.execute({ command: "node", args: ["-e", "process.exit(0)"], cwd: workspace, memoryMb: 128 }),
      (error: unknown) => error instanceof ResourceBoundaryViolation,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Phase 8.6 terminates execution after the timeout boundary", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-p86-timeout-"));
  try {
    const runtime = new EphemeralSandboxRuntime({
      resourcePolicy: {
        maxMemoryMb: 128,
        maxCpuMs: 5_000,
        maxFileDescriptors: 64,
        maxExecutionMs: 1_000,
        authorizedWorkspaces: [workspace],
      },
      processPolicy: {
        maxTimeoutMs: 1_000,
        maxMemoryMb: 128,
        maxOutputBytes: 100_000,
        maxCpuMs: 1_000,
        maxFileDescriptors: 64,
        allowedCommands: new Set(["node"]),
      },
    });
    const result = await runtime.execute({ command: "node", args: ["-e", "setTimeout(() => {}, 10_000)"], cwd: workspace, timeoutMs: 50, memoryMb: 128 });
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Phase 8.6 rejects filesystem execution outside an authorized workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-p86-authorized-"));
  const outside = await mkdtemp(join(tmpdir(), "klyn-p86-outside-"));
  try {
    const enforcer = new ResourceBoundaryEnforcer({
      maxMemoryMb: 128,
      maxCpuMs: 1_000,
      maxFileDescriptors: 64,
      maxExecutionMs: 1_000,
      authorizedWorkspaces: [workspace],
    });
    assert.throws(() => enforcer.validate({ cwd: outside }), ResourceBoundaryViolation);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("Phase 8.6 restores the workspace after an execution failure", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-p86-rollback-"));
  try {
    const target = join(workspace, "state.txt");
    await writeFile(target, "before", "utf8");
    const runtime = new EphemeralSandboxRuntime({
      resourcePolicy: {
        maxMemoryMb: 128,
        maxCpuMs: 5_000,
        maxFileDescriptors: 64,
        maxExecutionMs: 5_000,
        authorizedWorkspaces: [workspace],
      },
      processPolicy: {
        maxTimeoutMs: 5_000,
        maxMemoryMb: 128,
        maxOutputBytes: 100_000,
        maxCpuMs: 5_000,
        maxFileDescriptors: 64,
        allowedCommands: new Set(["node"]),
      },
    });
    const result = await runtime.execute({
      command: "node",
      args: ["-e", "require('node:fs').writeFileSync('state.txt','after'); process.exit(3)"],
      cwd: workspace,
      timeoutMs: 5_000,
      memoryMb: 128,
    });
    assert.equal(result.exitCode, 3);
    assert.equal(await readFile(target, "utf8"), "before");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Phase 8.6 snapshot engine creates and restores durable workspace state", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "klyn-p86-snapshot-"));
  try {
    const target = join(workspace, "value.txt");
    await writeFile(target, "stable", "utf8");
    const snapshots = new RuntimeSnapshotEngine();
    const snapshot = await snapshots.create(workspace);
    await writeFile(target, "mutated", "utf8");
    await snapshots.rollback(snapshot);
    assert.equal(await readFile(target, "utf8"), "stable");
    await snapshots.discard(snapshot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
