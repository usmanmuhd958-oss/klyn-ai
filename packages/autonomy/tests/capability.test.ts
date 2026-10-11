import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  AttenuatedCapabilityBuilderV1,
  CapabilityInvocationPipelineV1,
  CAPABILITY_TOKEN_SCHEMA,
  CAPABILITY_ATTESTATION_SCHEMA,
  Ed25519CapabilitySigner,
  Ed25519CapabilityTokenVerifier,
  digestCapabilityRequest,
  digestCapabilityToken,
  isBudgetAttenuation,
  isScopeAttenuation,
  type CapabilityBudget,
  type CapabilityEvidenceEvent,
  type CapabilityEvidenceSink,
  type CapabilityInvocationRequest,
  type CapabilityInvocationReservation,
  type CapabilitySandboxLease,
  type CapabilityResourceRequest,
  type ExecutionRuntimeCollector,
  type CapabilityInvocationCounter,
  type CapabilitySandboxEnforcer,
  type CapabilityRevocationRegistry,
  type CapabilityRevocation,
  type FileSystemCapabilityScope,
  type CapabilityTokenV1,
  type PreExecutionAttestationPayloadV1,
  verifyPreExecutionAttestation,
} from "../src/capability.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = new Ed25519CapabilitySigner("test-key-v1", privateKey, "root-authority");
const verifier = new Ed25519CapabilityTokenVerifier({
  resolvePublicKey: (keyId) => keyId === "test-key-v1" ? publicKey : undefined,
  resolvePrincipalId: (keyId) => keyId === "test-key-v1" ? "root-authority" : undefined,
});

const budget: CapabilityBudget = {
  maxInvocations: 100,
  maxConcurrentInvocations: 10,
  maxWallClockMsPerInvocation: 10_000,
  maxCpuMsPerInvocation: 5_000,
  maxMemoryBytes: 64 * 1024 * 1024,
  maxNetworkBytes: 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxProcesses: 2,
  maxFinancialSpendMinorUnits: 0,
};

const parentScope: FileSystemCapabilityScope = {
  kind: "filesystem",
  handleId: "fs-handle-1",
  resourceId: "workspace-1",
  operations: ["fs.read", "fs.list", "fs.write"],
  relativePathPrefix: "repo",
  maxBytesPerInvocation: 65536,
};

function makeParentToken() {
  const payload: CapabilityTokenV1 = {
    schema: CAPABILITY_TOKEN_SCHEMA,
    tokenId: "root-token-1",
    issuerPrincipalId: "root-authority",
    subjectPrincipalId: "agent-a",
    missionId: "mission-1",
    audience: "runtime-a",
    nonce: "root-nonce-1",
    issuedAtEpochMs: 1000,
    notBeforeEpochMs: 1000,
    expiresAtEpochMs: 10_000,
    parentTokenDigest: null,
    delegationDepth: 0,
    delegation: {
      enabled: true,
      maxDepth: 2,
      allowedDelegatePrincipalIds: ["agent-b"],
    },
    scopes: [parentScope],
    budget,
    policyDigest: "policy-v1",
  };
  return signer.signToken(payload);
}

function childScope(): FileSystemCapabilityScope {
  return {
    kind: "filesystem",
    handleId: "fs-handle-1",
    resourceId: "workspace-1",
    operations: ["fs.read", "fs.list"],
    relativePathPrefix: "repo/src",
    maxBytesPerInvocation: 4096,
  };
}

const childBudget: CapabilityBudget = {
  maxInvocations: 10,
  maxConcurrentInvocations: 2,
  maxWallClockMsPerInvocation: 2000,
  maxCpuMsPerInvocation: 1000,
  maxMemoryBytes: 8 * 1024 * 1024,
  maxNetworkBytes: 0,
  maxOutputBytes: 16 * 1024,
  maxProcesses: 0,
  maxFinancialSpendMinorUnits: 0,
};

class TestEvidenceSink implements CapabilityEvidenceSink {
  public events: CapabilityEvidenceEvent[] = [];
  public async append(event: CapabilityEvidenceEvent) {
    this.events.push(event);
    return {
      ledgerId: "test-ledger",
      evidenceId: "evidence-" + this.events.length,
      statementDigest: "a".repeat(64),
      committedAtEpochMs: 2000,
    };
  }
}

class TestRevocationRegistry implements CapabilityRevocationRegistry {
  public constructor(private readonly revoked = false) {}
  public async isRevoked(_tokenId: string, _tokenDigest: string, _nowEpochMs: number): Promise<boolean> {
    return this.revoked;
  }
  public async revoke(_revocation: CapabilityRevocation): Promise<void> {}
}

test("Ed25519 token signatures bind the complete capability payload", () => {
  const token = makeParentToken();
  verifier.verify(token, { nowEpochMs: 2000, subjectPrincipalId: "agent-a", audience: "runtime-a" });
  assert.match(digestCapabilityToken(token), /^[a-f0-9]{64}$/);
  const forged = structuredClone(token);
  (forged.payload as { subjectPrincipalId: string }).subjectPrincipalId = "agent-attacker";
  assert.throws(() => verifier.verify(forged, { nowEpochMs: 2000 }), /signature verification failed/);
});


test("pre-execution attestation is signed and bound to a specific invocation", () => {
  const payload: PreExecutionAttestationPayloadV1 = {
    schema: "urn:klyn:capability-preexecution-attestation:v1",
    invocationId: "invoke-1",
    tokenId: "token-1",
    tokenDigest: "a".repeat(64),
    principalId: "agent-a",
    missionId: "mission-1",
    runtimeInstanceId: "runtime-a",
    audience: "runtime-a",
    requestDigest: "b".repeat(64),
    scopeDigest: "c".repeat(64),
    policyDigest: "d".repeat(64),
    sandboxProfileDigest: "e".repeat(64),
    reservationId: "reservation-1",
    issuedAtEpochMs: 1000,
    expiresAtEpochMs: 3000,
  };
  const attestation = { payload, signature: signer.signPayload(payload) };
  verifyPreExecutionAttestation(attestation, {
    resolvePublicKey: (keyId) => keyId === "test-key-v1" ? publicKey : undefined,
    resolvePrincipalId: (keyId) => keyId === "test-key-v1" ? "root-authority" : undefined,
  }, { nowEpochMs: 2000, invocationId: "invoke-1", tokenDigest: "a".repeat(64), requestDigest: "b".repeat(64), runtimeInstanceId: "runtime-a" });
  assert.throws(() => verifyPreExecutionAttestation({
    payload: { ...payload, requestDigest: "f".repeat(64) },
    signature: attestation.signature,
  }, {
    resolvePublicKey: (keyId) => keyId === "test-key-v1" ? publicKey : undefined,
    resolvePrincipalId: (keyId) => keyId === "test-key-v1" ? "root-authority" : undefined,
  }, { nowEpochMs: 2000 }), /runtime attestation signature is not trusted/);
});

test("scope and budget comparisons only accept attenuation", () => {
  assert.equal(isScopeAttenuation(childScope(), parentScope), true);
  assert.equal(isScopeAttenuation({
    ...childScope(),
    relativePathPrefix: "repo2",
  }, parentScope), false);
  assert.equal(isScopeAttenuation({
    ...childScope(),
    operations: ["fs.read", "fs.write"],
  }, parentScope), true);
  assert.equal(isBudgetAttenuation(childBudget, budget), true);
  assert.equal(isBudgetAttenuation({ ...childBudget, maxInvocations: 101 }, budget), false);
});

test("attenuation signs the child, binds its parent digest and appends KEL evidence before returning", async () => {
  const parent = makeParentToken();
  const sink = new TestEvidenceSink();
  const builder = new AttenuatedCapabilityBuilderV1(
    parent,
    "agent-a",
    verifier,
    signer,
    sink,
    new TestRevocationRegistry(),
    () => 2000,
    (() => {
      let sequence = 0;
      return () => "child-id-" + (++sequence);
    })(),
  );
  const result = await builder.build({
    subjectPrincipalId: "agent-b",
    scopes: [childScope()],
    budget: childBudget,
    expiresAtEpochMs: 9000,
    delegation: { enabled: false, maxDepth: 1, allowedDelegatePrincipalIds: [] },
    reason: "Read source files for one mission",
    policyDigest: "policy-v1",
    missionId: "mission-1",
    runtimeInstanceId: "runtime-a",
  });
  verifier.verify(result.childToken, {
    nowEpochMs: 2001,
    subjectPrincipalId: "agent-b",
    audience: "runtime-a",
  });
  assert.equal(result.parentTokenDigest, digestCapabilityToken(parent));
  assert.equal(result.childToken.payload.parentTokenDigest, result.parentTokenDigest);
  assert.equal(result.kelEvidenceId, "evidence-1");
  assert.equal(sink.events[0]?.kind, "capability-attenuated");
  assert.equal(sink.events[0]?.missionId, "mission-1");
  assert.equal(sink.events[0]?.runtimeInstanceId, "runtime-a");
});

test("attenuation fails closed on scope escalation and unauthorized delegate", async () => {
  const parent = makeParentToken();
  const sink = new TestEvidenceSink();
  const builder = new AttenuatedCapabilityBuilderV1(parent, "agent-a", verifier, signer, sink, new TestRevocationRegistry(), () => 2000);
  await assert.rejects(builder.build({
    subjectPrincipalId: "agent-b",
    scopes: [{ ...childScope(), relativePathPrefix: "other-tree" }],
    budget: childBudget,
    expiresAtEpochMs: 9000,
    delegation: { enabled: false, maxDepth: 1, allowedDelegatePrincipalIds: [] },
    reason: "must fail",
    policyDigest: "policy-v1",
    missionId: "mission-1",
    runtimeInstanceId: "runtime-a",
  }), /child scopes must be strict subsets/);
  await assert.rejects(new AttenuatedCapabilityBuilderV1(
    parent, "agent-a", verifier, signer, sink, new TestRevocationRegistry(), () => 2000,
  ).build({
    subjectPrincipalId: "agent-c",
    scopes: [childScope()],
    budget: childBudget,
    expiresAtEpochMs: 9000,
    delegation: { enabled: false, maxDepth: 1, allowedDelegatePrincipalIds: [] },
    reason: "must fail",
    policyDigest: "policy-v1",
    missionId: "mission-1",
    runtimeInstanceId: "runtime-a",
  }), /recipient principal is not authorized/);
  assert.equal(sink.events.length, 0);
});


test("invocation appends a verified runtime attestation to KEL before dispatch", async () => {
  const token = makeParentToken();
  const sink = new TestEvidenceSink();
  const order: string[] = [];
  let finishedOutcome: string | undefined;

  const resourceBase: Omit<CapabilityResourceRequest, "requestDigest"> = {
    kind: "filesystem",
    handleId: "fs-handle-1",
    operation: "fs.read",
    resourceSelector: { relativePath: "repo/src/main.ts" },
    requestedBudgets: { maxOutputBytes: 4096 },
  };
  const operation: CapabilityResourceRequest = {
    ...resourceBase,
    requestDigest: digestCapabilityRequest(resourceBase),
  };
  const request: CapabilityInvocationRequest = {
    invocationId: "invoke-read-1",
    missionId: "mission-1",
    principalId: "agent-a",
    runtimeInstanceId: "runtime-a",
    audience: "runtime-a",
    token,
    operation,
    deadlineEpochMs: 8000,
    sandboxProfileDigest: "b".repeat(64),
  };

  const reservation: CapabilityInvocationReservation = {
    reservationId: "reservation-1",
    admittedInvocationNumber: 1,
  };
  const counters: CapabilityInvocationCounter = {
    async reserve(input) {
      assert.equal(input.tokenId, token.payload.tokenId);
      order.push("quota-reserved");
      return reservation;
    },
    async finish(id, outcome) {
      assert.equal(id, reservation.reservationId);
      finishedOutcome = outcome;
      order.push("quota-finished");
    },
  };
  const lease: CapabilitySandboxLease = {
    leaseId: "sandbox-lease-1",
    profileDigest: request.sandboxProfileDigest,
    expiresAtEpochMs: 7000,
  };
  const sandbox: CapabilitySandboxEnforcer = {
    async prepare(_request, scope, _budget) {
      assert.equal(scope.kind, "filesystem");
      order.push("sandbox-prepared");
      return lease;
    },
    async assertEnforced(actualLease) {
      assert.equal(actualLease.leaseId, lease.leaseId);
      order.push("sandbox-asserted");
    },
    async terminate(_lease, _reason) {
      order.push("sandbox-terminated");
    },
  };

  const collector: ExecutionRuntimeCollector = {
    async attestBeforeExecution(payload) {
      order.push("collector-attested");
      assert.equal(payload.invocationId, request.invocationId);
      return { payload, signature: signer.signPayload(payload) };
    },
  };

  const pipeline = new CapabilityInvocationPipelineV1({
    verifier,
    policyGate: {
      async assertCurrent(actualToken, actualRequest) {
        assert.equal(actualToken.payload.policyDigest, "policy-v1");
        assert.equal(actualRequest.missionId, "mission-1");
        order.push("policy-checked");
      },
    },
    revocations: new TestRevocationRegistry(),
    counters,
    sandbox,
    collector,
    collectorKeys: {
      resolvePublicKey: (keyId) => keyId === "test-key-v1" ? publicKey : undefined,
      resolvePrincipalId: (keyId) => keyId === "test-key-v1" ? "root-authority" : undefined,
    },
    evidence: {
      async append(event) {
        assert.equal(event.tokenId, token.payload.tokenId);
        if (event.kind === "capability-invocation-authorized") {
          order.push("kel-authorization-committed");
        } else if (event.kind === "capability-invocation-completed") {
          order.push("kel-completion-committed");
        }
        return sink.append(event);
      },
    },
    broker: {
      async perform() {
        throw new Error("broker must not be used by this read-only executor fixture");
      },
    },
    now: () => 2000,
    makeId: (() => {
      let n = 0;
      return () => "event-" + (++n);
    })(),
  });

  const result = await pipeline.invoke(request, {
    async execute(context) {
      assert.equal(context.authorizationEvidence.evidenceId, "evidence-1");
      assert.equal(context.preExecutionAttestation.payload.schema, CAPABILITY_ATTESTATION_SCHEMA);
      assert.equal(context.scope.kind, "filesystem");
      order.push("executor-dispatched");
      return "read-result";
    },
  });

  assert.equal(result, "read-result");
  assert.equal(finishedOutcome, "completed");
  assert.ok(order.indexOf("kel-authorization-committed") < order.indexOf("executor-dispatched"));
  assert.ok(order.indexOf("collector-attested") < order.indexOf("kel-authorization-committed"));
  assert.ok(order.indexOf("sandbox-asserted") < order.indexOf("executor-dispatched"));
  assert.ok(order.indexOf("executor-dispatched") < order.indexOf("kel-completion-committed"));
});

test("invocation rejects a bad request digest before sandbox setup or execution", async () => {
  const token = makeParentToken();
  let sandboxPrepareCalled = false;
  let executorCalled = false;
  const resourceBase: Omit<CapabilityResourceRequest, "requestDigest"> = {
    kind: "filesystem",
    handleId: "fs-handle-1",
    operation: "fs.read",
    resourceSelector: { relativePath: "repo/src/main.ts" },
    requestedBudgets: {},
  };
  const request: CapabilityInvocationRequest = {
    invocationId: "invoke-read-bad",
    missionId: "mission-1",
    principalId: "agent-a",
    runtimeInstanceId: "runtime-a",
    audience: "runtime-a",
    token,
    operation: { ...resourceBase, requestDigest: "0".repeat(64) },
    deadlineEpochMs: 8000,
    sandboxProfileDigest: "b".repeat(64),
  };
  const counters: CapabilityInvocationCounter = {
    async reserve() {
      return { reservationId: "reservation-bad", admittedInvocationNumber: 1 };
    },
    async finish() {},
  };
  const sandbox: CapabilitySandboxEnforcer = {
    async prepare() {
      sandboxPrepareCalled = true;
      return { leaseId: "lease-bad", profileDigest: request.sandboxProfileDigest, expiresAtEpochMs: 7000 };
    },
    async assertEnforced() {},
    async terminate() {},
  };
  const pipeline = new CapabilityInvocationPipelineV1({
    verifier,
    policyGate: { async assertCurrent() {} },
    revocations: new TestRevocationRegistry(),
    counters,
    sandbox,
    collector: { async attestBeforeExecution(payload) { return { payload, signature: signer.signPayload(payload) }; } },
    collectorKeys: {
      resolvePublicKey: (keyId) => keyId === "test-key-v1" ? publicKey : undefined,
      resolvePrincipalId: (keyId) => keyId === "test-key-v1" ? "root-authority" : undefined,
    },
    evidence: new TestEvidenceSink(),
    broker: { async perform() { return null; } },
    now: () => 2000,
  });
  await assert.rejects(pipeline.invoke(request, {
    async execute() {
      executorCalled = true;
      return "not-run";
    },
  }), /request digest does not match/);
  assert.equal(sandboxPrepareCalled, false);
  assert.equal(executorCalled, false);
});
