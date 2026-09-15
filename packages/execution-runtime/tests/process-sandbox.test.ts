import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProcessSandboxManager } from "../src/process-sandbox-manager.js";
import { SecretMasker } from "../src/secret-masker.js";

describe("ProcessSandboxManager", () => {
  it("runs without a shell and redacts secret-like output", async () => {
    const sandbox = new ProcessSandboxManager();
    const result = await sandbox.execute({
      command: process.execPath,
      args: ["-e", "console.log('Bearer abcdefghijklmnop'); console.error('api_key=supersecret')"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, API_TOKEN: "not-child-visible" },
      allowedEnv: ["PATH"],
      timeoutMs: 2_000,
      memoryMb: 128,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.match(result.stdout, /\[REDACTED\]/);
    assert.match(result.stderr, /\[REDACTED\]/);
  });

  it("terminates a process that exceeds the execution deadline", async () => {
    const sandbox = new ProcessSandboxManager();
    const result = await sandbox.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      cwd: process.cwd(),
      timeoutMs: 100,
      memoryMb: 128,
    });
    assert.equal(result.timedOut, true);
  });

  it("enforces a single-owner execution fence", () => {
    const sandbox = new ProcessSandboxManager();
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
