import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_PROCESS_SANDBOX_POLICY,
  ObservationCollector,
  PolicyGovernedSandbox,
  ProcessSandboxManager,
  SandboxPolicyEngine,
  SandboxPolicyViolation,
  type ObservationClock,
  type ProcessSandboxResult,
  type SandboxPolicyCeilings,
  type IntentResourceBudget,
} from "../src/index.js";

const BYTES_PER_MIB = 1024 * 1024;

const budget: IntentResourceBudget = {
  maxCpuMillis: 5_000,
  maxMemoryBytes: 64 * BYTES_PER_MIB,
  maxWallClockMillis: 5_000,
  maxConcurrentTasks: 2,
  maxNetworkRequests: 0,
  maxArtifactBytes: 64 * 1024,
};

function ceilings(overrides: Partial<SandboxPolicyCeilings> = {}): SandboxPolicyCeilings {
  return {
    maxCpuMillis: 5_000,
    maxMemoryBytes: 64 * BYTES_PER_MIB,
    maxWallClockMillis: 5_000,
    maxFileDescriptors: 64,
    maxChildProcesses: 0,
    maxNetworkRequests: 0,
    maxArtifactBytes: 64 * 1024,
    maxConcurrentTasks: 2,
    maxOutputBytes: 64 * 1024,
    allowedCommands: new Set(["node"]),
    allowedNetworkHosts: new Set(),
    ...overrides,
  };
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "klyn-step-2-1-"));
}

test("rejects an intent memory budget above the runtime ceiling before sandbox creation", async () => {
  const workspace = await tempWorkspace();
  try {
    const engine = new SandboxPolicyEngine(ceilings({ maxMemoryBytes: 32 * BYTES_PER_MIB }));
    assert.throws(
      () => engine.translate({ ...budget, maxMemoryBytes: 64 * BYTES_PER_MIB }, { workspace }),
      (error: unknown) => error instanceof SandboxPolicyViolation && error.code === "MEMORY_LIMIT",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rejects an execution allocation above the intent-derived memory policy", async () => {
  const workspace = await tempWorkspace();
  try {
    const engine = new SandboxPolicyEngine(ceilings());
    const policy = engine.translate(budget, { workspace });
    assert.throws(
      () => engine.validateRequest(policy, { resourceBudget: budget, memoryBytes: 65 * BYTES_PER_MIB }),
      (error: unknown) => error instanceof SandboxPolicyViolation && error.code === "MEMORY_LIMIT",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

class CountingManager extends ProcessSandboxManager {
  calls = 0;

  override execute(): Promise<ProcessSandboxResult> {
    this.calls += 1;
    return Promise.resolve({ exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 0, timedOut: false, memoryExceeded: false });
  }
}

test("traps unauthorized filesystem access before process instantiation", async () => {
  const workspace = await tempWorkspace();
  try {
    const manager = new CountingManager();
    const sandbox = new PolicyGovernedSandbox({
      policyEngine: new SandboxPolicyEngine(ceilings()),
      processManager: manager,
    });
    await assert.rejects(
      sandbox.execute({
        intentId: "intent-1",
        taskId: "task-1",
        agentId: "agent-1",
        resourceBudget: budget,
        cwd: workspace,
        command: "node",
        args: ["-e", "console.log('must-not-run')"],
        filesystemAccess: [{ path: join(workspace, "..", "outside.txt"), mode: "write" }],
      }),
      (error: unknown) => error instanceof SandboxPolicyViolation && error.code === "FILESYSTEM_PATH_DENIED",
    );
    assert.equal(manager.calls, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("traps unauthorized network access before process instantiation", async () => {
  const workspace = await tempWorkspace();
  try {
    const manager = new CountingManager();
    const sandbox = new PolicyGovernedSandbox({
      policyEngine: new SandboxPolicyEngine(ceilings()),
      processManager: manager,
    });
    await assert.rejects(
      sandbox.execute({
        intentId: "intent-2",
        taskId: "task-2",
        agentId: "agent-2",
        resourceBudget: budget,
        cwd: workspace,
        command: "node",
        args: ["-e", "console.log('must-not-run')"],
        networkHosts: ["example.com"],
      }),
      (error: unknown) => error instanceof SandboxPolicyViolation && error.code === "NETWORK_HOST_DENIED",
    );
    assert.equal(manager.calls, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rolls workspace state back after a failed worker execution", async () => {
  const workspace = await tempWorkspace();
  const target = join(workspace, "state.txt");
  try {
    await writeFile(target, "before", "utf8");
    const sandbox = new PolicyGovernedSandbox({
      policyEngine: new SandboxPolicyEngine(ceilings()),
      processManager: new ProcessSandboxManager(DEFAULT_PROCESS_SANDBOX_POLICY),
    });
    const result = await sandbox.execute({
      intentId: "intent-3",
      taskId: "task-3",
      agentId: "agent-3",
      resourceBudget: budget,
      cwd: workspace,
      command: "node",
      args: ["-e", "require('node:fs').writeFileSync('state.txt', 'after'); process.exit(7)"],
      filesystemAccess: [{ path: target, mode: "write" }],
    });

    assert.equal(result.rolledBack, true);
    assert.equal(result.rollbackReason, "process exited with code 7");
    assert.equal(await readFile(target, "utf8"), "before");
    assert.equal(result.events.some((event) => event.type === "filesystem.modified"), true);
    assert.equal(result.events.some((event) => event.type === "sandbox.rollback"), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("collects successful execution, stdout, file mutation, resource snapshot and exit evidence", async () => {
  const workspace = await tempWorkspace();
  try {
    const sandbox = new PolicyGovernedSandbox({
      policyEngine: new SandboxPolicyEngine(ceilings()),
      processManager: new ProcessSandboxManager(DEFAULT_PROCESS_SANDBOX_POLICY),
    });
    const result = await sandbox.execute({
      intentId: "intent-4",
      taskId: "task-4",
      agentId: "agent-4",
      resourceBudget: budget,
      cwd: workspace,
      command: "node",
      args: ["-e", "require('node:fs').writeFileSync('created.txt', 'evidence'); console.log('hello')"],
      filesystemAccess: [{ path: join(workspace, "created.txt"), mode: "write" }],
    });

    assert.equal(result.rolledBack, false);
    assert.equal(await readFile(join(workspace, "created.txt"), "utf8"), "evidence");
    assert.ok(result.events.some((event) => event.type === "stdout"));
    assert.ok(result.events.some((event) => event.type === "filesystem.created"));
    assert.ok(result.events.some((event) => event.type === "resource.snapshot"));
    assert.ok(result.events.some((event) => event.type === "process.exited"));
    assert.match(result.eventStreamHash, /^[a-f0-9]{64}$/);
    for (const event of result.events) assert.match(event.hash, /^[a-f0-9]{64}$/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("produces deterministic cryptographic event streams for identical inputs and clock", () => {
  const fixedClock: ObservationClock = { now: () => 1_700_000_000_000 };
  const build = (): ReturnType<ObservationCollector["finalize"]> => {
    const collector = new ObservationCollector(fixedClock);
    collector.begin({ executionId: "execution-1", taskId: "task-1", agentId: "agent-1" });
    collector.record("process.started", { args: ["-e", "console.log('x')"], command: "node" });
    collector.record("stdout", { value: "x\n" });
    collector.recordFilesystemMutations(new Map([["state.txt", "hash-before"]]), new Map([["state.txt", "hash-after"], ["new.txt", "hash-new"]]));
    collector.record("process.exited", { exitCode: 0, signal: null, rolledBack: false });
    return collector.finalize();
  };

  const first = build();
  const second = build();
  assert.deepEqual(second.events, first.events);
  assert.equal(second.streamHash, first.streamHash);
  assert.match(first.streamHash, /^[a-f0-9]{64}$/);
  assert.equal(first.events[0]?.previousHash, "0".repeat(64));
  for (let index = 1; index < first.events.length; index += 1) {
    assert.equal(first.events[index]?.previousHash, first.events[index - 1]?.hash);
  }
});
