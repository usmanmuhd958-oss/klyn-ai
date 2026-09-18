import { test } from "node:test";
import assert from "node:assert/strict";
import { GovernanceEngine } from "@klyn/governance";
import { BudgetLedger } from "@klyn/autonomy";
import { ContainmentController } from "../src/ContainmentController.js";
import { ExecutionController } from "../src/ExecutionController.js";
import type { ControlPlaneExecutionRequest } from "../src/types.js";
import type { AutonomyEnvelope } from "@klyn/autonomy";
import type { RuntimeExecutionResult, TaskSpec } from "@klyn/runtime";

const makeEnvelope = (): AutonomyEnvelope => ({
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
    networkRequests: 10,
    financialSpendMinorUnits: 1_000n,
    toolInvocations: 10,
    wallClockMillis: 1_000,
  },
  warningThresholds: {
    tokens: 0.8,
    computeMillis: 0.8,
    networkRequests: 0.8,
    financialSpendMinorUnits: 0.8,
    toolInvocations: 0.8,
    wallClockMillis: 0.8,
  },
  escalationThresholds: {
    tokens: 0.9,
    computeMillis: 0.9,
    networkRequests: 0.9,
    financialSpendMinorUnits: 0.9,
    toolInvocations: 0.9,
    wallClockMillis: 0.9,
  },
  allowedTools: [
    { toolName: "builder", operations: ["execute"], maxRisk: "medium" },
  ],
  maxRisk: "medium",
  maxDelegationDepth: 1,
});

const task: TaskSpec = {
  schemaVersion: "1.0.0",
  taskId: "task-1",
  workloadRef: "builder-task",
  args: [],
  priority: 1,
  signals: {
    estimatedCpuMillis: 100,
    estimatedMemoryBytes: 1024,
    latencyBudgetMillis: 100,
    batchSize: 1,
    requiresIsolation: false,
    preferredAccelerator: "CPU",
    requiresGpu: false,
    requiresNetwork: false,
    resourceRequest: {
      minCpuCores: 1,
      maxCpuMillis: 100,
      maxMemoryBytes: 1024,
      maxWallClockMillis: 100,
      gpuCount: 0,
      minGpuMemoryBytes: 0,
      maxNetworkRequests: 0,
      maxArtifactBytes: 1024,
    },
  },
};

const request = (): ControlPlaneExecutionRequest => ({
  intent: {
    missionId: "mission-1",
    objectiveId: "objective-1",
    statement: "Execute builder task",
    requestedTool: "builder",
    requestedOperation: "execute",
  },
  authorizationRequest: {
    requestId: "request-1",
    objectiveId: "objective-1",
    principal: { principalId: "principal-1", sessionId: "session-1" },
    toolName: "builder",
    operation: "execute",
    risk: "medium",
    declaredPurpose: "build artifact",
    requestedAtEpochMs: 1,
  },
  authorizationScopes: [
    {
      scopeId: "scope-1",
      principalId: "principal-1",
      toolName: "builder",
      operation: "execute",
      maxRisk: "medium",
      resources: [],
      networkOrigins: [],
      expiresAtEpochMs: 100_000,
      policyVersion: "policy-1",
    },
  ],
  task,
  estimatedUsage: {
    tokens: 0,
    computeMillis: 100,
    networkRequests: 0,
    financialSpendMinorUnits: 0n,
    toolInvocations: 1,
    wallClockMillis: 100,
  },
});

test("execution controller enforces governance before runtime", async () => {
  const governance = new GovernanceEngine();
  const budget = new BudgetLedger(makeEnvelope());
  const containment = new ContainmentController({
    missionId: "mission-1",
    agentId: "agent-1",
    principalId: "principal-1",
    governance,
    budget,
  });

  let executed = false;
  const runtimeResult: RuntimeExecutionResult = {
    status: "SUCCEEDED_VERIFIED",
    plan: {} as RuntimeExecutionResult["plan"],
    observation: {
      exitCode: 0,
      usage: {
        cpuMillis: 50,
        memoryBytes: 1024,
        wallClockMillis: 50,
        gpuCount: 0,
        gpuMemoryBytes: 0,
        networkRequests: 0,
        artifactBytes: 10,
      },
      verification: { verified: true, reasons: ["test"] },
      outputDigest: "0".repeat(64),
    },
  };

  const execution = new ExecutionController({
    governance,
    runtime: {
      execute: async () => {
        executed = true;
        return runtimeResult;
      },
    },
    budget,
    containment,
  });

  const result = await execution.execute(request());
  assert.equal(result.authorization.allowed, true);
  assert.equal(executed, true);
  assert.equal(result.budget.usage.toolInvocations, 1);
  assert.equal(governance.audit.verify(), true);
});
