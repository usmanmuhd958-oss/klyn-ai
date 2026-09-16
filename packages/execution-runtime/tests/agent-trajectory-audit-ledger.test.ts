import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentTrajectoryAuditLedger } from "../src/agent-trajectory-audit-ledger.js";
import type { ToolAuditRecord } from "../src/hermetic-tool-contracts.js";

const audit = (sequence: number, previousAuditHash: string | null): ToolAuditRecord => ({
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

describe("AgentTrajectoryAuditLedger", () => {
  it("creates one immutable link per audit record", () => {
    const ledger = new AgentTrajectoryAuditLedger();
    ledger.record("step-1", audit(0, null));
    ledger.record("step-2", audit(1, "audit-0"));
    assert.deepEqual(ledger.snapshot().map((link) => link.auditHash), ["audit-0", "audit-1"]);
  });

  it("rejects duplicate steps and broken audit continuity", () => {
    const ledger = new AgentTrajectoryAuditLedger();
    ledger.record("step-1", audit(0, null));
    assert.throws(() => ledger.record("step-1", audit(1, "audit-0")), /Duplicate agent trajectory step/);
    assert.throws(() => ledger.record("step-2", audit(1, "wrong")), /audit chain discontinuity/i);
  });
});
