import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import {
  AuditLedger,
  GovernanceEngine,
  signEd25519,
} from "@klyn/governance";
import {
  AgentBehaviorTrace,
  ConstraintViolationDetector,
  behaviorEventDigest,
} from "../src/index.js";
import type {
  AgentBehaviorEvent,
  BehaviorPolicy,
} from "../src/types.js";

const policy: BehaviorPolicy = {
  missionId: "mission-1",
  agentId: "agent-1",
  expectedPolicyVersion: "policy-1",
  maxDelegationDepth: 1,
  allowedToolOperations: {
    builder: ["execute"],
  },
  allowedSideEffects: ["artifact"],
  requireToolAuthorization: true,
  requireStateDigestChangeForMutation: true,
  requireExplicitSideEffectDeclaration: true,
};

function event(overrides: Partial<AgentBehaviorEvent> = {}): AgentBehaviorEvent {
  return {
    eventType: "tool-call",
    missionId: "mission-1",
    agentId: "agent-1",
    timestampEpochMs: 1,
    policyVersion: "policy-1",
    stateDigestBefore: "a".repeat(64),
    stateDigestAfter: "b".repeat(64),
    toolCall: {
      toolName: "builder",
      operation: "execute",
      requestId: "req-1",
      authorization: {
        allowed: true,
        reason: "granted",
        requestId: "req-1",
        scopeId: "scope-1",
        evaluatedAtEpochMs: 1,
      },
      sideEffects: [],
    },
    ...overrides,
  };
}

test("behavior trace is hash chained and mirrored into governance audit", () => {
  const audit = new AuditLedger();
  const trace = new AgentBehaviorTrace(audit);
  const record = trace.append(event());

  assert.equal(trace.verify(), true);
  assert.equal(trace.snapshot().length, 1);
  assert.equal(audit.records().at(-1)?.event.kind, "agent-behavior");
  assert.equal(audit.verify(), true);
  assert.equal(record.hash, behaviorEventDigest(event()));
});

test("detector catches policy drift, unauthorized side effects, and invalid delegation", () => {
  const detector = new ConstraintViolationDetector(policy);
  const recordTrace = new AgentBehaviorTrace();
  const record = recordTrace.append(event({
    policyVersion: "policy-2",
    sideEffects: [{
      effectId: "effect-1",
      kind: "database",
      locator: "prod-db",
      operation: "write",
    }],
    delegation: {
      delegationId: "d-1",
      parentAgentId: "agent-1",
      childAgentId: "agent-2",
      depth: 2,
      requestedRisk: "high",
      delegatedToolNames: ["builder"],
    },
  }));

  const result = detector.observe(record);
  assert.equal(result.accepted, false);
  assert.ok(result.violations.some((v) => v.kind === "policy-drift"));
  assert.ok(result.violations.some((v) => v.kind === "unauthorized-side-effect"));
  assert.ok(result.violations.some((v) => v.kind === "invalid-delegation"));
});

test("detector catches undeclared memory mutation", () => {
  const detector = new ConstraintViolationDetector(policy);
  const trace = new AgentBehaviorTrace();
  const record = trace.append(event({
    eventType: "memory-mutation",
    toolCall: undefined,
    memoryMutation: {
      namespace: "agent-memory",
      key: "goal",
      beforeDigest: "a".repeat(64),
      afterDigest: "b".repeat(64),
      declared: false,
    },
  }));

  const result = detector.observe(record);
  assert.equal(result.accepted, false);
  assert.ok(result.violations.some((v) => v.kind === "hidden-state-shift"));
});

test("governance-backed authorization event can be embedded in a trace", () => {
  const governance = new GovernanceEngine();
  const decision = governance.authorize({
    requestId: "req-1",
    objectiveId: "objective-1",
    principal: { principalId: "principal-1", sessionId: "session-1" },
    toolName: "builder",
    operation: "execute",
    risk: "low",
    declaredPurpose: "build",
    requestedAtEpochMs: 1,
  }, [{
    scopeId: "scope-1",
    principalId: "principal-1",
    toolName: "builder",
    operation: "execute",
    maxRisk: "low",
    resources: [],
    networkOrigins: [],
    expiresAtEpochMs: 100,
    policyVersion: "policy-1",
  }], 1);
  assert.equal(decision.allowed, true);
  assert.equal(governance.audit.verify(), true);
});
