import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  AttenuatedCapabilityBuilderV1,
  CAPABILITY_TOKEN_SCHEMA,
  Ed25519CapabilitySigner,
  Ed25519CapabilityTokenVerifier,
  digestCapabilityToken,
  isBudgetAttenuation,
  isScopeAttenuation,
  type CapabilityBudget,
  type CapabilityEvidenceEvent,
  type CapabilityEvidenceSink,
  type FileSystemCapabilityScope,
  type CapabilityTokenV1,
} from "../src/capability.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = new Ed25519CapabilitySigner("test-key-v1", privateKey);
const verifier = new Ed25519CapabilityTokenVerifier({
  resolvePublicKey: (keyId) => keyId === "test-key-v1" ? publicKey : undefined,
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

test("Ed25519 token signatures bind the complete capability payload", () => {
  const token = makeParentToken();
  verifier.verify(token, { nowEpochMs: 2000, subjectPrincipalId: "agent-a", audience: "runtime-a" });
  assert.match(digestCapabilityToken(token), /^[a-f0-9]{64}$/);
  const forged = structuredClone(token);
  (forged.payload as { subjectPrincipalId: string }).subjectPrincipalId = "agent-attacker";
  assert.throws(() => verifier.verify(forged, { nowEpochMs: 2000 }), /signature verification failed/);
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
  const builder = new AttenuatedCapabilityBuilderV1(parent, "agent-a", verifier, signer, sink, () => 2000);
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
    parent, "agent-a", verifier, signer, sink, () => 2000,
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
