import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentToolExecutor, AgentTrajectoryLedger } from "../src/index.js";
import type { HermeticToolCall, ToolAuditRecord, ToolExecutionKernel } from "@klyn/execution-runtime";

const makeAudit = (sequence: number, previousAuditHash: string | null): ToolAuditRecord => ({
  sequence,
  callId: `call-${sequence}`,
  agentId: "agent-1",
  intentId: "intent-1",
  tool: "file-tree",
  requestHash: `request-${sequence}`,
  resultHash: `result-${sequence}`,
  previousAuditHash,
  auditHash: `audit-${sequence}`,
});

const call: HermeticToolCall = {
  callId: "call-1",
  agentId: "agent-1",
  intentId: "intent-1",
  workingDirectory: ".",
  tool: "file-tree",
  args: { operation: "read", path: "README.md" },
};

describe("AgentToolExecutor", () => {
  it("binds each successful kernel execution to exactly one audit trajectory step", async () => {
    const trajectory = new AgentTrajectoryLedger();
    const audit = makeAudit(0, null);
    const kernel: ToolExecutionKernel = {
      execute: async () => ({ result: { path: "README.md", content: "ok", sha256: "sha" }, audit }),
      getAuditTrail: () => [audit],
    };
    const executor = new AgentToolExecutor(kernel, trajectory);
    const result = await executor.execute({ call, stepId: "step-1", runId: "run-1", role: "coder" });
    assert.equal(result.audit.auditHash, "audit-0");
    assert.deepEqual(trajectory.snapshot().map((step) => step.auditHash), ["audit-0"]);
  });
});

describe("AgentTrajectoryLedger", () => {
  it("rejects audit-chain discontinuity", () => {
    const trajectory = new AgentTrajectoryLedger();
    trajectory.append({ stepId: "step-1", runId: "run", agentId: "agent-1", role: "coder", intentId: "intent-1", audit: makeAudit(0, null) });
    assert.throws(() => trajectory.append({
      stepId: "step-2",
      runId: "run",
      agentId: "agent-1",
      role: "coder",
      intentId: "intent-1",
      audit: makeAudit(1, "wrong-prev"),
    }), /Audit discontinuity/);
  });
});
