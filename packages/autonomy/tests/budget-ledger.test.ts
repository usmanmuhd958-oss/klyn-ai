import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetLedger } from "../src/budget-ledger.js";
import type { AutonomyEnvelope, UsageMetrics } from "../src/types.js";

const usage = (overrides: Partial<UsageMetrics> = {}): UsageMetrics => ({
  tokens: 0,
  computeMillis: 0,
  networkRequests: 0,
  financialSpendMinorUnits: 0n,
  toolInvocations: 0,
  wallClockMillis: 0,
  ...overrides,
});

const envelope = (): AutonomyEnvelope => ({
  schemaVersion: 1,
  missionId: "mission-1",
  agentId: "agent-1",
  principalId: "principal-1",
  policyVersion: "policy-1",
  issuedAtEpochMs: 0,
  expiresAtEpochMs: 100_000,
  limits: {
    tokens: 100,
    computeMillis: 1_000,
    networkRequests: 100,
    financialSpendMinorUnits: 10_000n,
    toolInvocations: 10,
    wallClockMillis: 1_000,
  },
  warningThresholds: {
    tokens: 0.5,
    computeMillis: 0.5,
    networkRequests: 0.5,
    financialSpendMinorUnits: 0.5,
    toolInvocations: 0.5,
    wallClockMillis: 0.5,
  },
  escalationThresholds: {
    tokens: 0.8,
    computeMillis: 0.8,
    networkRequests: 0.8,
    financialSpendMinorUnits: 0.8,
    toolInvocations: 0.8,
    wallClockMillis: 0.8,
  },
  allowedTools: [
    { toolName: "builder", operations: ["execute"], maxRisk: "high" },
  ],
  maxRisk: "high",
  maxDelegationDepth: 2,
});

test("budget ledger escalates before hard termination", () => {
  const ledger = new BudgetLedger(envelope());

  assert.equal(ledger.record(usage({ tokens: 40 })).action, "CONTINUE");
  assert.equal(ledger.record(usage({ tokens: 20 })).action, "WARN");
  assert.equal(ledger.record(usage({ tokens: 20 })).action, "ESCALATE");
  assert.equal(ledger.record(usage({ tokens: 21 })).action, "TERMINATE");
  assert.equal(ledger.isTerminated(), true);
});

test("budget admission rejects a projected hard breach without consuming usage", () => {
  const ledger = new BudgetLedger(envelope());
  const admission = ledger.admit(usage({ tokens: 101 }), 1);

  assert.equal(admission.admitted, false);
  assert.match(admission.reason, /tokens/);
  assert.equal(ledger.snapshot().usage.tokens, 0);
});

test("financial accounting stays exact with bigint", () => {
  const ledger = new BudgetLedger(envelope());

  const decision = ledger.record(usage({ financialSpendMinorUnits: 8_000n }));
  assert.equal(decision.action, "ESCALATE");
  assert.equal(decision.usage.financialSpendMinorUnits, 8_000n);
  assert.equal(decision.remaining.financialSpendMinorUnits, 2_000n);
});
