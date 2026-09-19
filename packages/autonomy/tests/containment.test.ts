import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetLedger } from "../src/budget-ledger.js";
import { AutonomyContainmentError, RealTimeContainmentInterceptor } from "../src/containment.js";
import type { AutonomyEnvelope, UsageMetrics } from "../src/types.js";

const baseEnvelope: AutonomyEnvelope = {
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
  allowedTools: [],
  maxRisk: "low",
  maxDelegationDepth: 0,
};

const usage = (tokens: number): UsageMetrics => ({
  tokens,
  computeMillis: 0,
  networkRequests: 0,
  financialSpendMinorUnits: 0n,
  toolInvocations: 0,
  wallClockMillis: 0,
});

test("real-time interceptor terminates when escalation is denied", async () => {
  let terminated = false;
  const interceptor = new RealTimeContainmentInterceptor(new BudgetLedger(baseEnvelope), {
    onEscalate: async () => false,
    onTerminate: () => {
      terminated = true;
    },
  });

  await interceptor.intercept(usage(80), 1);
  await assert.rejects(
    interceptor.intercept(usage(1), 2),
    (error: unknown) => error instanceof AutonomyContainmentError,
  );
  assert.equal(terminated, true);
  assert.equal(interceptor.isTerminated(), true);
});

test("usage monitor consumes an async stream until abort", async () => {
  const controller = new AbortController();
  const interceptor = new RealTimeContainmentInterceptor(new BudgetLedger(baseEnvelope()));

  async function* stream(): AsyncIterable<UsageMetrics> {
    yield usage(10);
    controller.abort();
    yield usage(10);
  }

  await interceptor.monitor(stream(), controller.signal);
  assert.equal(interceptor.isTerminated(), false);
});
