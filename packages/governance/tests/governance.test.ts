import { strict as assert } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import {
  GovernanceEngine,
  ValidationError,
  parseToolExecutionScope,
  sha256,
} from '../src/index.js';

function validScope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scopeId: 'scope-1',
    principalId: 'agent-1',
    toolName: 'repo.read',
    operation: 'read',
    maxRisk: 'medium',
    resources: [
      { kind: 'filesystem', match: 'prefix', value: '/workspace/klyn/' },
    ],
    networkOrigins: [],
    expiresAtEpochMs: 2_000_000,
    policyVersion: 'phase3-v1',
    ...overrides,
  };
}

function validRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'req-1',
    objectiveId: 'obj-1',
    principal: { principalId: 'agent-1', sessionId: 'session-1' },
    toolName: 'repo.read',
    operation: 'read',
    risk: 'low',
    resource: { kind: 'filesystem', locator: '/workspace/klyn/src/index.ts' },
    declaredPurpose: 'inspect source',
    requestedAtEpochMs: 1_000_000,
    ...overrides,
  };
}

function objective() {
  return {
    objectiveId: 'obj-1',
    policyVersion: 'phase3-v1',
    requiredInvariants: [
      { invariantId: 'INV-1', statement: 'typecheck passes' },
      { invariantId: 'INV-2', statement: 'audit chain verifies' },
    ],
  };
}

function evidence(evidenceId: string, invariantIds: readonly string[], verificationStatus: 'verified' | 'rejected' = 'verified') {
  return {
    evidenceId,
    objectiveId: 'obj-1',
    kind: 'test-result',
    statement: `evidence ${evidenceId}`,
    source: 'ci://phase3',
    payloadDigest: sha256(evidenceId),
    invariantIds,
    verificationStatus,
    verifierId: 'verifier-1',
    collectedAtEpochMs: 1_000_001,
  };
}

function artifact() {
  return {
    artifactId: 'artifact-1',
    artifactKind: 'build-output',
    contentDigest: sha256('artifact-content'),
    producerPrincipalId: 'agent-1',
    objectiveId: 'obj-1',
    sourceCommitDigest: sha256('commit-1'),
    createdAtEpochMs: 1_000_002,
  };
}

test('P3-01: malformed requests fail closed', () => {
  const governance = new GovernanceEngine();
  const decision = governance.authorize({ requestId: 'req-bad' }, [], 1_000);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'malformed-request');
});

test('P3-02: no scope means deny by default', () => {
  const governance = new GovernanceEngine();
  const decision = governance.authorize(validRequest(), [], 1_000);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'no-matching-scope');
});

test('P3-03: exact principal/tool/operation scope is required for allow', () => {
  const governance = new GovernanceEngine();
  const decision = governance.authorize(validRequest(), [validScope()], 1_000);
  assert.equal(decision.allowed, true);
  assert.equal(decision.scopeId, 'scope-1');
});

test('P3-04: resource prefix matching enforces path boundaries', () => {
  const governance = new GovernanceEngine();
  const decision = governance.authorize(
    validRequest({ resource: { kind: 'filesystem', locator: '/workspace/klyn-private/file.ts' } }),
    [validScope()],
    1_000,
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'resource-not-allowed');
});

test('P3-05: risk above scope ceiling is denied', () => {
  const governance = new GovernanceEngine();
  const decision = governance.authorize(validRequest({ risk: 'critical' }), [validScope({ maxRisk: 'high' })], 1_000);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'risk-exceeds-scope');
});

test('P3-06: expired scope is denied', () => {
  const governance = new GovernanceEngine();
  const decision = governance.authorize(validRequest(), [validScope({ expiresAtEpochMs: 999 })], 1_000);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'scope-expired');
});

test('P3-07: wildcard scopes are rejected at the runtime boundary', () => {
  assert.throws(() => parseToolExecutionScope(validScope({ toolName: '*' })), ValidationError);
});

test('P3-08: missing verified evidence blocks completion', () => {
  const governance = new GovernanceEngine();
  governance.recordEvidence(evidence('ev-1', ['INV-1']));
  const decision = governance.evaluateCompletion(objective(), 1_000_003);
  assert.equal(decision.complete, false);
  assert.deepEqual(decision.missingInvariantIds, ['INV-2']);
});

test('P3-09: rejected evidence can never satisfy an invariant', () => {
  const governance = new GovernanceEngine();
  governance.recordEvidence(evidence('ev-1', ['INV-1'], 'rejected'));
  governance.recordEvidence(evidence('ev-2', ['INV-2']));
  const decision = governance.evaluateCompletion(objective(), 1_000_003);
  assert.equal(decision.complete, false);
  assert.deepEqual(decision.missingInvariantIds, ['INV-1']);
  assert.deepEqual(decision.rejectedEvidenceIds, ['ev-1']);
});

test('P3-10: every required invariant must have verified evidence before completion', () => {
  const governance = new GovernanceEngine();
  governance.recordEvidence(evidence('ev-1', ['INV-1']));
  governance.recordEvidence(evidence('ev-2', ['INV-2']));
  const decision = governance.evaluateCompletion(objective(), 1_000_003);
  assert.equal(decision.complete, true);
  assert.deepEqual(decision.missingInvariantIds, []);
  assert.deepEqual(decision.acceptedEvidenceIds, ['ev-1', 'ev-2']);
});

test('P3-11: artifact attestation recomputes the completion gate and cannot trust caller-supplied completion state', () => {
  const governance = new GovernanceEngine();
  const { privateKey } = generateKeyPairSync('ed25519');
  assert.throws(() => governance.attestArtifact(artifact(), objective(), 'test-key', privateKey, 1_000_003), ValidationError);
});

test('P3-12: Ed25519 attestation verifies and tampering fails', () => {
  const governance = new GovernanceEngine();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  governance.recordEvidence(evidence('ev-1', ['INV-1']));
  governance.recordEvidence(evidence('ev-2', ['INV-2']));
  const attestation = governance.attestArtifact(artifact(), objective(), 'test-key', privateKey, 1_000_003);
  assert.equal(governance.attestation.verify(attestation, publicKey), true);

  const tampered = { ...attestation, artifact: { ...attestation.artifact, contentDigest: sha256('different') } };
  assert.equal(governance.attestation.verify(tampered, publicKey), false);
});

test('P3-13: audit records form an immutable hash-linked chain', () => {
  const governance = new GovernanceEngine();
  governance.authorize(validRequest(), [validScope()], 1_000);
  governance.recordEvidence(evidence('ev-1', ['INV-1']));
  assert.equal(governance.audit.verify(), true);
  const first = governance.audit.records()[0];
  assert.ok(first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first?.event), true);
});

test('P3-14: artifact attestation binds to the audit head that existed immediately before attestation', () => {
  const governance = new GovernanceEngine();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  governance.recordEvidence(evidence('ev-1', ['INV-1']));
  governance.recordEvidence(evidence('ev-2', ['INV-2']));
  const attestation = governance.attestArtifact(artifact(), objective(), 'test-key', privateKey, 1_000_003);
  const records = governance.audit.records();
  const artifactRecord = records.at(-1);
  const headBeforeArtifactRecord = records.at(-2);
  assert.ok(artifactRecord);
  assert.ok(headBeforeArtifactRecord);
  assert.equal(attestation.auditHeadHash, headBeforeArtifactRecord?.hash);
  assert.equal(governance.attestation.verify(attestation, publicKey), true);
  assert.notEqual(governance.audit.headHash(), attestation.auditHeadHash);
  assert.equal(governance.audit.verify(), true);
});
