import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  Ed25519EvidenceVerifier,
  MissionStateMachine,
  MissionTransitionError,
  VerifiableMissionGraph,
  digestJson,
  graphDigestInput,
  signEvidence,
  type MissionEvidence,
  type MissionGraph,
} from '../src/index.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const verifier = new Ed25519EvidenceVerifier('phase5-verifier', publicKey);

function graph(): MissionGraph {
  const base = {
    schemaVersion: '1.0.0' as const,
    missionId: 'm-1',
    objectiveId: 'o-1',
    nodes: [
      { nodeId: 'n-action', state: 'ACTION_EXECUTED' as const, invariantIds: [], dependsOn: [] },
      { nodeId: 'n-artifact', state: 'ARTIFACT_PRODUCED' as const, invariantIds: ['artifact-ready'], dependsOn: ['n-action'] },
      { nodeId: 'n-test', state: 'TEST_PASSED' as const, invariantIds: ['tests-green'], dependsOn: ['n-artifact'] },
      { nodeId: 'n-requirement', state: 'REQUIREMENT_VERIFIED' as const, invariantIds: ['requirement-met'], dependsOn: ['n-test'] },
      { nodeId: 'n-deploy', state: 'DEPLOYMENT_CONFIRMED' as const, invariantIds: ['deployed'], dependsOn: ['n-requirement'] },
    ],
    invariants: [
      { invariantId: 'artifact-ready', statement: 'Required artifact exists.' },
      { invariantId: 'tests-green', statement: 'Required test suite passed.' },
      { invariantId: 'requirement-met', statement: 'Objective requirement is verified.' },
      { invariantId: 'deployed', statement: 'Deployment is confirmed.' },
    ],
  };
  return { ...base, graphDigest: digestJson(graphDigestInput(base)) };
}

function evidence(
  nodeId: string,
  kind: MissionEvidence['kind'],
  evidenceId: string,
  predecessors: readonly string[],
  invariantIds: readonly string[],
  artifactDigest?: string,
  issuedAtEpochMs = 1000,
): MissionEvidence {
  const unsigned = {
    evidenceId,
    missionId: 'm-1',
    objectiveId: 'o-1',
    nodeId,
    kind,
    statement: `${kind}:${evidenceId}`,
    ...(artifactDigest === undefined ? {} : { artifactDigest }),
    invariantIds,
    predecessorEvidenceIds: predecessors,
    issuedAtEpochMs,
    verifierId: 'phase5-verifier',
  } satisfies Omit<MissionEvidence, 'payloadDigest' | 'signatureBase64'>;
  return Object.freeze({ ...unsigned, ...signEvidence(unsigned, privateKey) });
}

function machine(nowEpochMs = 2000): MissionStateMachine {
  return new MissionStateMachine(new VerifiableMissionGraph(graph()), { evidenceVerifier: verifier, nowEpochMs: () => nowEpochMs });
}

function advanceToTest(machineInstance: MissionStateMachine): string {
  machineInstance.transition(evidence('n-action', 'action-receipt', 'e1', [], []));
  const artifactDigest = digestJson({ artifact: 'build-1' });
  machineInstance.transition(evidence('n-artifact', 'artifact-manifest', 'e2', ['e1'], ['artifact-ready'], artifactDigest));
  machineInstance.transition(evidence('n-test', 'test-result', 'e3', ['e2'], ['tests-green'], artifactDigest));
  return artifactDigest;
}

test('P5-01: exact state sequence is deterministic', () => {
  const m = machine();
  assert.equal(m.snapshot().currentState, 'NOT_STARTED');
  m.transition(evidence('n-action', 'action-receipt', 'e1', [], []));
  assert.equal(m.snapshot().currentState, 'ACTION_EXECUTED');
  const artifactDigest = digestJson({ artifact: 'build-1' });
  m.transition(evidence('n-artifact', 'artifact-manifest', 'e2', ['e1'], ['artifact-ready'], artifactDigest));
  assert.equal(m.snapshot().currentState, 'ARTIFACT_PRODUCED');
  m.transition(evidence('n-test', 'test-result', 'e3', ['e2'], ['tests-green'], artifactDigest));
  assert.equal(m.snapshot().currentState, 'TEST_PASSED');
});

test('P5-02: Test Passed does not imply Requirement Verified', () => {
  const m = machine();
  advanceToTest(m);
  assert.equal(m.snapshot().currentState, 'TEST_PASSED');
  assert.equal(m.snapshot().satisfiedInvariantIds.includes('requirement-met'), false);
});

test('P5-03: requirement verification requires cryptographic proof', () => {
  const m = machine();
  const artifactDigest = advanceToTest(m);
  m.transition(evidence('n-requirement', 'requirement-proof', 'e4', ['e3'], ['requirement-met'], artifactDigest));
  assert.equal(m.snapshot().currentState, 'REQUIREMENT_VERIFIED');
});

test('P5-04: deployment confirmation requires requirement proof', () => {
  const m = machine();
  const artifactDigest = advanceToTest(m);
  assert.throws(() => m.transition(evidence('n-deploy', 'deployment-attestation', 'e4', ['e3'], ['deployed'], artifactDigest)), MissionTransitionError);
});

test('P5-05: deployment confirmation follows requirement verification', () => {
  const m = machine();
  const artifactDigest = advanceToTest(m);
  m.transition(evidence('n-requirement', 'requirement-proof', 'e4', ['e3'], ['requirement-met'], artifactDigest));
  m.transition(evidence('n-deploy', 'deployment-attestation', 'e5', ['e4'], ['deployed'], artifactDigest));
  assert.equal(m.snapshot().currentState, 'DEPLOYMENT_CONFIRMED');
});

test('P5-06: tampered evidence fails cryptographic verification', () => {
  const m = machine();
  const tampered = evidence('n-action', 'action-receipt', 'e1', [], []);
  assert.throws(() => m.transition({ ...tampered, statement: 'tampered' }), MissionTransitionError);
});

test('P5-07: wrong evidence kind cannot advance state', () => {
  const m = machine();
  assert.throws(() => m.transition(evidence('n-action', 'test-result', 'e1', [], [])), MissionTransitionError);
});

test('P5-08: evidence from another mission is rejected', () => {
  const m = machine();
  const wrong = evidence('n-action', 'action-receipt', 'e1', [], []);
  assert.throws(() => m.transition({ ...wrong, missionId: 'other' }), MissionTransitionError);
});

test('P5-09: graph digest tampering is rejected', () => {
  const g = graph();
  assert.throws(() => new VerifiableMissionGraph({ ...g, objectiveId: 'tampered' }), Error);
});

test('P5-10: dependency cycles are rejected', () => {
  const g = graph();
  const cyclic = { ...g, nodes: g.nodes.map((node) => node.nodeId === 'n-action' ? { ...node, dependsOn: ['n-deploy'] } : node) };
  const rebuilt = { ...cyclic, graphDigest: digestJson(graphDigestInput(cyclic)) };
  assert.throws(() => new VerifiableMissionGraph(rebuilt), Error);
});

test('P5-11: artifact binding prevents testing an unrelated artifact', () => {
  const m = machine();
  m.transition(evidence('n-action', 'action-receipt', 'e1', [], []));
  const firstArtifact = digestJson({ artifact: 'build-1' });
  m.transition(evidence('n-artifact', 'artifact-manifest', 'e2', ['e1'], ['artifact-ready'], firstArtifact));
  const unrelated = digestJson({ artifact: 'build-2' });
  assert.throws(() => m.transition(evidence('n-test', 'test-result', 'e3', ['e2'], ['tests-green'], unrelated)), MissionTransitionError);
});

test('P5-12: requirement proof must cover graph invariants', () => {
  const m = machine();
  const artifactDigest = advanceToTest(m);
  assert.throws(() => m.transition(evidence('n-requirement', 'requirement-proof', 'e4', ['e3'], [], artifactDigest)), MissionTransitionError);
});

test('P5-13: predecessor evidence must be accepted first', () => {
  const m = machine();
  assert.throws(() => m.transition(evidence('n-action', 'action-receipt', 'e1', ['unknown'], [])), MissionTransitionError);
});

test('P5-14: unsigned evidence is rejected', () => {
  const m = machine();
  const unsigned = evidence('n-action', 'action-receipt', 'e1', [], []);
  const { signatureBase64: _signature, ...withoutSignature } = unsigned;
  assert.throws(() => m.transition(withoutSignature), MissionTransitionError);
});

test('P5-15: completed mission cannot advance beyond deployment', () => {
  const m = machine();
  const artifactDigest = advanceToTest(m);
  m.transition(evidence('n-requirement', 'requirement-proof', 'e4', ['e3'], ['requirement-met'], artifactDigest));
  m.transition(evidence('n-deploy', 'deployment-attestation', 'e5', ['e4'], ['deployed'], artifactDigest));
  assert.throws(() => m.transition(evidence('n-deploy', 'deployment-attestation', 'e6', ['e5'], ['deployed'], artifactDigest)), MissionTransitionError);
});

test('P5-16: future-dated evidence is rejected before state mutation', () => {
  const m = machine(2000);
  assert.throws(() => m.transition(evidence('n-action', 'action-receipt', 'e1', [], [], undefined, 3000)), MissionTransitionError);
  assert.equal(m.snapshot().currentState, 'NOT_STARTED');
  assert.equal(m.snapshot().evidenceIds.length, 0);
});

test('P5-17: deterministic replay reconstructs the terminal state', () => {
  const artifactDigest = digestJson({ artifact: 'build-1' });
  const log = [
    evidence('n-action', 'action-receipt', 'e1', []),
    evidence('n-artifact', 'artifact-manifest', 'e2', ['e1'], ['artifact-ready'], artifactDigest),
    evidence('n-test', 'test-result', 'e3', ['e2'], ['tests-green'], artifactDigest),
    evidence('n-requirement', 'requirement-proof', 'e4', ['e3'], ['requirement-met'], artifactDigest),
    evidence('n-deploy', 'deployment-attestation', 'e5', ['e4'], ['deployed'], artifactDigest),
  ];
  const replayed = MissionStateMachine.replay(new VerifiableMissionGraph(graph()), log, { evidenceVerifier: verifier, nowEpochMs: () => 2000 });
  assert.equal(replayed.snapshot().currentState, 'DEPLOYMENT_CONFIRMED');
  assert.equal(replayed.snapshot().evidenceIds.length, 5);
});

test('P5-18: extra dependency edges are rejected as non-deterministic', () => {
  const g = graph();
  const ambiguous = {
    ...g,
    nodes: g.nodes.map((node) => node.nodeId === 'n-test' ? { ...node, dependsOn: ['n-artifact', 'n-action'] } : node),
  };
  const rebuilt = { ...ambiguous, graphDigest: digestJson(graphDigestInput(ambiguous)) };
  assert.throws(() => new VerifiableMissionGraph(rebuilt), Error);
});

test('P5-19: malformed artifact digest is rejected at the evidence boundary', () => {
  const m = machine();
  const malformed = evidence('n-action', 'action-receipt', 'e1', []);
  assert.throws(() => m.transition({ ...malformed, artifactDigest: 'not-a-sha256-digest' }), Error);
});

test('P5-20: duplicate predecessor references are rejected', () => {
  const m = machine();
  m.transition(evidence('n-action', 'action-receipt', 'e1', []));
  const artifactDigest = digestJson({ artifact: 'build-1' });
  const duplicatePredecessor = evidence('n-artifact', 'artifact-manifest', 'e2', ['e1', 'e1'], ['artifact-ready'], artifactDigest);
  assert.throws(() => m.transition(duplicatePredecessor), Error);
});

test('P5-21: non-Ed25519 verification keys are rejected', () => {
  const { publicKey: rsaPublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => new Ed25519EvidenceVerifier('invalid', rsaPublicKey), Error);
});
