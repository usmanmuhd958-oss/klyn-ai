import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  HermeticToolCall,
  HermeticToolResult,
  ProcessSandboxResult,
  ToolAuditRecord,
  ToolExecutionKernel,
} from "@klyn/execution-runtime";
import { AgentToolExecutor } from "../src/tool-executor.js";
import { AgentTrajectoryLedger } from "../src/trajectory-ledger.js";
import {
  SelfHealingController,
  SelfHealingExhaustedError,
} from "../src/self-healing-controller.js";

const failure = (message: string): ProcessSandboxResult => ({
  exitCode: 1,
  signal: null,
  stdout: "",
  stderr: `src/example.ts:1:7: error: ${message}`,
  durationMs: 1,
  timedOut: false,
  memoryExceeded: false,
});

const success = (): ProcessSandboxResult => ({
  exitCode: 0,
  signal: null,
  stdout: "ok",
  stderr: "",
  durationMs: 1,
  timedOut: false,
  memoryExceeded: false,
});

class FakeKernel implements ToolExecutionKernel {
  private sequence = 0;
  private previous: string | null = null;
  private readonly audits: ToolAuditRecord[] = [];

  async execute(call: HermeticToolCall): Promise<{ result: HermeticToolResult; audit: ToolAuditRecord }> {
    const audit: ToolAuditRecord = {
      sequence: this.sequence,
      callId: call.callId,
      agentId: call.agentId,
      intentId: call.intentId,
      tool: call.tool,
      requestHash: `request-${this.sequence}`,
      resultHash: `result-${this.sequence}`,
      previousAuditHash: this.previous,
      auditHash: `audit-${this.sequence}`,
    };
    this.sequence += 1;
    this.previous = audit.auditHash;
    this.audits.push(audit);
    return {
      audit,
      result: {
        path: "src/example.ts",
        sha256: `sha-${this.sequence}`,
        replacementsApplied: 1,
      },
    };
  }

  getAuditTrail(): readonly ToolAuditRecord[] {
    return this.audits;
  }
}

const repairCall = (callId = "repair-call-1"): HermeticToolCall => ({
  callId,
  agentId: "coder-1",
  intentId: "intent-1",
  workingDirectory: "/workspace",
  tool: "ast-patch",
  args: {
    operation: "apply-replacements",
    path: "src/example.ts",
    expectedSha256: "expected-sha",
    replacements: [{ start: 0, end: 1, replacement: "const" }],
  },
});

describe("SelfHealingController", () => {
  it("repairs a failing test and binds the repair to an immutable audit record", async () => {
    const kernel = new FakeKernel();
    const executor = new AgentToolExecutor(kernel, new AgentTrajectoryLedger());
    let testRuns = 0;
    const controller = new SelfHealingController(executor, {
      async plan(input) {
        assert.equal(input.diagnostics[0]?.line, 1);
        assert.equal(input.diagnostics[0]?.column, 7);
        assert.equal(input.previousRepairAuditHash, null);
        return repairCall();
      },
    });

    const result = await controller.run({
      runId: "run-1",
      intentId: "intent-1",
      agentId: "coder-1",
      cwd: "/workspace",
      executeTest: async () => {
        testRuns += 1;
        return testRuns === 1 ? failure("broken syntax") : success();
      },
    });

    assert.equal(result.finalResult.exitCode, 0);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.repairAuditHash, "audit-0");
    assert.equal(result.attempts[0]?.repairEvidenceHash.length, 64);
    assert.equal(kernel.getAuditTrail().length, 1);
  });

  it("halts after the bounded retry depth", async () => {
    const kernel = new FakeKernel();
    const executor = new AgentToolExecutor(kernel, new AgentTrajectoryLedger());
    const controller = new SelfHealingController(executor, {
      async plan() {
        return repairCall("repair-call-repeated");
      },
    }, { maxAttempts: 3 });

    await assert.rejects(
      controller.run({
        runId: "run-exhausted",
        intentId: "intent-1",
        agentId: "coder-1",
        cwd: "/workspace",
        executeTest: async () => failure("unresolvable logic error"),
      }),
      (error: unknown) => {
        assert.ok(error instanceof SelfHealingExhaustedError);
        assert.equal(error.attempts.length, 3);
        return true;
      },
    );
    assert.equal(kernel.getAuditTrail().length, 3);
  });
});
