import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProcessSandboxManager, type ProcessSandboxPolicy } from "../src/process-sandbox-manager.js";
import { SecretMasker } from "../src/secret-masker.js";

const helper = process.env.KLYN_SANDBOX_HELPER;
const rootfs = process.env.KLYN_SANDBOX_ROOTFS;
const nodeBinary = process.env.KLYN_SANDBOX_NODE ?? "/usr/bin/node";

function policy(): ProcessSandboxPolicy {
  if (!helper || !rootfs) throw new Error("native sandbox integration environment is not configured");
  return {
    maxTimeoutMs: 5_000,
    maxMemoryMb: 128,
    maxOutputBytes: 100_000,
    maxCpuMs: 5_000,
    maxFileDescriptors: 64,
    allowedCommands: new Set([nodeBinary]),
    nativeHelperPath: helper,
    rootfs,
    syscallProfile: "strict-linux-v1",
  };
}

describe("ProcessSandboxManager", () => {
  it("runs inside the native sandbox and redacts secret-like output", { skip: !helper || !rootfs }, async () => {
    const sandbox = new ProcessSandboxManager(policy());
    const result = await sandbox.execute({
      command: nodeBinary,
      args: ["-e", "console.log('Bearer abcdefghijklmnop'); console.error('api_key=supersecret')"],
      cwd: process.cwd(),
      env: { PATH: "/usr/bin" },
      allowedEnv: ["PATH"],
      timeoutMs: 5_000,
      memoryMb: 128,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.match(result.stdout, /\[REDACTED\]/);
    assert.match(result.stderr, /\[REDACTED\]/);
  });

  it("terminates a native sandbox process that exceeds the deadline", { skip: !helper || !rootfs }, async () => {
    const sandbox = new ProcessSandboxManager(policy());
    const result = await sandbox.execute({
      command: nodeBinary,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      cwd: process.cwd(),
      timeoutMs: 100,
      memoryMb: 128,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.terminationReason, "timeout");
  });

  it("rejects non-absolute executable identities", () => {
    const sandbox = new ProcessSandboxManager({
      maxTimeoutMs: 1000,
      maxMemoryMb: 128,
      maxOutputBytes: 1000,
      maxCpuMs: 1000,
      maxFileDescriptors: 32,
      allowedCommands: new Set(["node"]),
      rootfs: "/tmp",
      syscallProfile: "strict-linux-v1",
    });
    assert.throws(() => sandbox.execute({
      command: "node",
      cwd: process.cwd(),
      allowedEnv: [],
    }), /absolute executable path/);
  });

  it("enforces a single-owner execution fence", () => {
    const sandbox = new ProcessSandboxManager({
      maxTimeoutMs: 1000,
      maxMemoryMb: 128,
      maxOutputBytes: 1000,
      maxCpuMs: 1000,
      maxFileDescriptors: 32,
      allowedCommands: new Set(),
      rootfs: "/tmp",
      syscallProfile: "strict-linux-v1",
    });
    assert.equal(sandbox.acquireFence("task-1", "worker-a"), true);
    assert.equal(sandbox.acquireFence("task-1", "worker-b"), false);
    assert.equal(sandbox.releaseFence("task-1", "worker-b"), false);
    assert.equal(sandbox.releaseFence("task-1", "worker-a"), true);
    assert.equal(sandbox.acquireFence("task-1", "worker-b"), true);
  });
});

describe("SecretMasker", () => {
  it("removes secret keys from child environments and redacts credential patterns", () => {
    const masker = new SecretMasker();
    const env = masker.maskEnvironment({ PATH: "/bin", API_TOKEN: "secret", SAFE_VALUE: "ok" }, ["PATH", "API_TOKEN", "SAFE_VALUE"]);
    assert.deepEqual(env, { PATH: "/bin", SAFE_VALUE: "ok" });
    assert.equal(masker.redact("token=supersecret"), "[REDACTED]");
  });
});
