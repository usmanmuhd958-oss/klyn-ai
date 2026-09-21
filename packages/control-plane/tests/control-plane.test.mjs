import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KlynControlPlane,
  AnomalyEngine,
  CircuitBreakerEngine,
  ContextLocalityManager,
  HeterogeneousScheduler,
  InMemoryLedgerStore,
  ResourceEnvelopeEngine,
  VMGEngine,
  brand,
  workerId,
  MerkleCheckpointEngine,
  BlackBoxTraceEngine,
  SandboxManager,
} from '../dist/index.js';

const missionId = brand('00000000-0000-4000-8000-000000000001', 'MissionId');
const tenantId = brand('00000000-0000-4000-8000-000000000002', 'TenantId');
const policyId = brand('00000000-0000-4000-8000-000000000003', 'PolicyId');
const executionId = brand('00000000-0000-4000-8000-000000000004', 'ExecutionId');
const actor = { actorId: brand('00000000-0000-4000-8000-000000000005', 'AgentId'), principalType: 'AGENT' };

function vector(value) {
  return { identity: value, capability: value, resource: value, temporal: value, state: value, sequence: value, artifact: value, infrastructure: value };
}

test('ledger builds and verifies a cryptographic chain', async () => {
  const ledger = new InMemoryLedgerStore();
  await ledger.append({ missionId, eventType: 'MissionCreated', occurredAt: '2026-09-18T12:00:00.000Z', actor, schemaVersion: 1, payload: { objective: 'test' } });
  await ledger.append({ missionId, eventType: 'VerificationStarted', occurredAt: '2026-09-18T12:00:01.000Z', actor, schemaVersion: 1, payload: { check: 'syntax' } });
  const result = await ledger.verify(missionId);
  const events = await ledger.list(missionId);
  assert.equal(events[0].sequence, 1n);
  assert.equal(events[1].sequence, 2n);
  assert.equal(result.valid, true);
});

test('VMG rejects optimistic-lock conflicts and invalid guard transitions', () => {
  const engine = new VMGEngine();
  const mission = {
    missionId, tenantId, policyId, state: 'INTENT_CAPTURED', version: 0n, breakerLevel: 'NONE',
    createdAt: '2026-09-18T12:00:00.000Z', updatedAt: '2026-09-18T12:00:00.000Z', ledgerSequence: 0n,
    ledgerHeadHash: '0'.repeat(64),
  };
  assert.throws(() => engine.transition(mission, 'ENVELOPE_DEFINED', 1n, {
    envelopeValid: true, planAuthorized: false, executionSucceeded: false, artifactProvenanceValid: false,
    verificationStatus: 'NOT_RUN', humanApprovalValid: false, rolloutSucceeded: false, breakerLevel: 'NONE'
  }), /VERSION_CONFLICT/);
  assert.throws(() => engine.transition(mission, 'ENVELOPE_DEFINED', 0n, {
    envelopeValid: false, planAuthorized: false, executionSucceeded: false, artifactProvenanceValid: false,
    verificationStatus: 'NOT_RUN', humanApprovalValid: false, rolloutSucceeded: false, breakerLevel: 'NONE'
  }), /VALID_ENVELOPE_REQUIRED/);
});

test('resource reservations fail closed at hard caps', async () => {
  const engine = new ResourceEnvelopeEngine('test-signing-key');
  const envelope = await engine.create({
    missionId, executionId, policyId, issuedAt: '2026-09-18T12:00:00.000Z', expiresAt: '2099-09-18T12:00:00.000Z',
    tokenBudget: { inputMax: 100n, outputMax: 100n, totalMax: 150n },
    computeBudget: { cpuMillicores: 1000, memoryBytes: 1024n, gpuMillicores: 0, diskWriteBytesMax: 1000n, networkEgressBytesMax: 1000n },
    latencyBudget: { missionTimeoutMs: 30000, executionTimeoutMs: 10000, toolTimeoutMs: 5000 },
    allowedCapabilities: ['RepoRead'],
    networkPolicy: { allowEgress: false, allowedHosts: [] },
  });
  assert.throws(() => engine.reserve(envelope, {
    reservationId: 'r1', envelopeId: envelope.envelopeId, executionId,
    inputTokens: 101n, outputTokens: 0n, cpuMillicoresMs: 0, memoryBytes: 1n,
    gpuMillicoresMs: 0, diskWriteBytes: 0n, networkEgressBytes: 0n, wallClockMs: 1,
  }), /TOKEN_RESERVATION_EXCEEDS_CAP/);
});

test('resource reservations are atomically bounded in aggregate', async () => {
  const engine = new ResourceEnvelopeEngine('test-signing-key');
  const envelope = await engine.create({
    missionId, executionId, policyId, issuedAt: '2026-09-18T12:00:00.000Z', expiresAt: '2099-09-18T12:00:00.000Z',
    tokenBudget: { inputMax: 100n, outputMax: 100n, totalMax: 100n },
    computeBudget: { cpuMillicores: 100, memoryBytes: 100n, gpuMillicores: 0, diskWriteBytesMax: 100n, networkEgressBytesMax: 100n },
    latencyBudget: { missionTimeoutMs: 10000, executionTimeoutMs: 5000, toolTimeoutMs: 1000 }, allowedCapabilities: ['RepoRead'], networkPolicy: { allowEgress: false, allowedHosts: [] },
  });
  engine.reserve(envelope, { reservationId: 'r2', envelopeId: envelope.envelopeId, executionId, inputTokens: 60n, outputTokens: 0n, cpuMillicoresMs: 0, memoryBytes: 60n, gpuMillicoresMs: 0, diskWriteBytes: 0n, networkEgressBytes: 0n, wallClockMs: 1 });
  assert.throws(() => engine.reserve(envelope, { reservationId: 'r3', envelopeId: envelope.envelopeId, executionId, inputTokens: 50n, outputTokens: 0n, cpuMillicoresMs: 0, memoryBytes: 50n, gpuMillicoresMs: 0, diskWriteBytes: 0n, networkEgressBytes: 0n, wallClockMs: 1 }), /AGGREGATE_TOKEN_RESERVATION_EXCEEDS_CAP/);
});

test('scheduler applies hard constraints before scoring', () => {
  const scheduler = new HeterogeneousScheduler();
  const decision = scheduler.assign({
    requiredCapabilities: ['RepoRead'], minMemoryBytes: 1024n, minCpuCores: 2, gpuRequired: false,
    locality: 'LOCAL_ON_PREM_ONLY', privacy: 'LOCAL_ON_PREM_ONLY', networkRequired: false,
    modelCapabilities: [],
  }, [
    { nodeId: workerId('remote'), executionClass: 'REMOTE_MODEL', availableMemoryBytes: 16384n, availableCpuCores: 8, hasGpu: true, privacyDomain: 'PUBLIC_CLOUD_ALLOWED', capabilities: ['RepoRead'], modelCapabilities: [], queueDepth: 0, latencyP50Ms: 10, estimatedCostMilliunits: 1, health: 'HEALTHY', networkAvailable: true },
    { nodeId: workerId('local'), executionClass: 'MICROVM', availableMemoryBytes: 4096n, availableCpuCores: 4, hasGpu: false, privacyDomain: 'LOCAL_ON_PREM_ONLY', capabilities: ['RepoRead'], modelCapabilities: [], queueDepth: 1, latencyP50Ms: 30, estimatedCostMilliunits: 20, health: 'HEALTHY', networkAvailable: false },
  ]);
  assert.equal(decision.worker.nodeId, 'local');
});

test('context projection retains critical nodes and records omissions', () => {
  const manager = new ContextLocalityManager();
  const nodes = [
    { nodeId: 'critical', missionId, layer: 'L1', kind: 'CONSTRAINT', summary: 'migration order', contentDigest: 'a'.repeat(64), tokenCost: 100, importance: 1, critical: true, sourceEventIds: [brand('00000000-0000-4000-8000-000000000006', 'EventId')], parents: [] },
    { nodeId: 'large', missionId, layer: 'L2', kind: 'TOOL_RESULT', summary: 'history', contentDigest: 'b'.repeat(64), tokenCost: 10000, importance: .2, critical: false, sourceEventIds: [], parents: [] },
  ];
  const projection = manager.project(missionId, nodes, 100);
  assert.equal(projection.nodes[0].nodeId, 'critical');
  assert.equal(projection.losslessForCriticalState, true);
  assert.equal(projection.omittedNodeIds.includes('large'), true);
});

test('anomaly engine escalates hard violations to mission halt', () => {
  const engine = new AnomalyEngine();
  const evidence = engine.evaluate({ expected: vector(0), observed: vector(0.1), systemBaseline: vector(0), hardViolations: ['CAPABILITY_ESCALATION'] });
  assert.equal(evidence.breakerLevel, 'MISSION_HALT');
});

test('breaker escalation is monotonic', () => {
  const engine = new CircuitBreakerEngine();
  const first = engine.trigger(missionId, 'EXECUTION_HALT', 'timeout', '2026-09-18T12:00:00.000Z');
  const second = engine.trigger(missionId, 'MISSION_HALT', 'capability escalation', '2026-09-18T12:00:01.000Z');
  const sameOrHigher = engine.trigger(missionId, 'SOFT_HALT', 'late signal', '2026-09-18T12:00:02.000Z');
  assert.equal(first.level, 'EXECUTION_HALT');
  assert.equal(second.level, 'MISSION_HALT');
  assert.equal(sameOrHigher.level, 'MISSION_HALT');
});

test('control plane creates missions at INTENT_CAPTURED', async () => {
  const plane = new KlynControlPlane();
  const mission = await plane.createMission({ tenantId, policyId, occurredAt: '2026-09-18T12:00:00.000Z', actor, objective: 'build artifact', constraints: ['no public network'], idempotencyKey: 'idem-create-001' });
  assert.equal(mission.state, 'INTENT_CAPTURED');
  assert.equal(mission.version, 0n);
  const events = await plane.store.readEvents(mission.missionId);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'MissionCreated');
});

test('Merkle checkpoint is deterministic and verifiable', async () => {
  const ledger = new InMemoryLedgerStore();
  await ledger.append({ missionId, eventType: 'MissionCreated', occurredAt: '2026-09-18T12:00:00.000Z', actor, schemaVersion: 1, payload: { n: 1 } });
  await ledger.append({ missionId, eventType: 'VerificationStarted', occurredAt: '2026-09-18T12:00:01.000Z', actor, schemaVersion: 1, payload: { n: 2 } });
  const checkpoint = await new MerkleCheckpointEngine().create(missionId, await ledger.list(missionId));
  assert.equal(await new MerkleCheckpointEngine().verify(checkpoint, await ledger.list(missionId)), true);
});

test('black-box trace records ordered event digests', async () => {
  const trace = new BlackBoxTraceEngine();
  const span = trace.startSpan(missionId, actor.actorId);
  await trace.record(span.spanId, { operation: 'compile' });
  const ended = trace.end(span.spanId);
  assert.equal(ended.eventDigests.length, 1);
  assert.ok(ended.endedAt);
});

test('sandbox manager fails closed on invalid lifecycle transitions', async () => {
  const driver = {
    create: async () => {}, start: async () => {}, beginExecution: async () => {}, stop: async () => {}, destroy: async () => {},
  };
  const engine = new ResourceEnvelopeEngine('test-signing-key');
  const envelope = await engine.create({
    missionId, executionId, policyId, issuedAt: '2026-09-18T12:00:00.000Z', expiresAt: '2099-09-18T12:00:00.000Z',
    tokenBudget: { inputMax: 10n, outputMax: 10n, totalMax: 20n },
    computeBudget: { cpuMillicores: 100, memoryBytes: 1024n, gpuMillicores: 0, diskWriteBytesMax: 100n, networkEgressBytesMax: 0n },
    latencyBudget: { missionTimeoutMs: 1000, executionTimeoutMs: 500, toolTimeoutMs: 100 }, allowedCapabilities: ['RepoRead'], networkPolicy: { allowEgress: false, allowedHosts: [] },
  });
  const manager = new SandboxManager(driver);
  const created = await manager.create(envelope, { kind: 'MICROVM', rootFsDigest: 'sha256:' + 'a'.repeat(64), seccompProfile: 'default' });
  assert.equal(created.state, 'STARTING');
  await assert.rejects(() => manager.beginExecution(created.sandboxId), (error) => error?.code === 'INVALID_SANDBOX_TRANSITION');
});

test('context topology rejects cyclic parent relationships', () => {
  const manager = new ContextLocalityManager();
  const nodes = [
    { nodeId: 'a', missionId, layer: 'L1', kind: 'FACT', summary: 'a', contentDigest: 'a'.repeat(64), tokenCost: 1, importance: .5, critical: false, sourceEventIds: [], parents: ['b'] },
    { nodeId: 'b', missionId, layer: 'L1', kind: 'FACT', summary: 'b', contentDigest: 'b'.repeat(64), tokenCost: 1, importance: .5, critical: false, sourceEventIds: [], parents: ['a'] },
  ];
  assert.throws(() => manager.validateTopology(nodes), /CONTEXT_CYCLE_DETECTED/);
});

test('mission transition store serializes concurrent optimistic writes', async () => {
  const plane = new KlynControlPlane();
  const mission = await plane.createMission({ tenantId, policyId, occurredAt: '2026-09-18T12:00:00.000Z', actor, objective: 'concurrent transition', constraints: [], idempotencyKey: 'idem-create-002' });
  const ctx = { envelopeValid: true, planAuthorized: false, executionSucceeded: false, artifactProvenanceValid: false, verificationStatus: 'NOT_RUN', humanApprovalValid: false, rolloutSucceeded: false, breakerLevel: 'NONE' };
  const results = await Promise.allSettled([
    plane.transition(mission.missionId, 'ENVELOPE_DEFINED', 0n, ctx, actor, {}, '2026-09-18T12:00:00.001Z'),
    plane.transition(mission.missionId, 'ENVELOPE_DEFINED', 0n, ctx, actor, {}, '2026-09-18T12:00:00.002Z'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
});


test('mission creation idempotency returns the original mission and rejects divergent reuse', async () => {
  const plane = new KlynControlPlane();
  const first = await plane.createMission({ tenantId, policyId, occurredAt: '2026-09-18T12:00:00.000Z', actor, objective: 'same request', constraints: [], idempotencyKey: 'idem-create-003' });
  const replay = await plane.createMission({ tenantId, policyId, occurredAt: '2026-09-18T12:00:00.000Z', actor, objective: 'same request', constraints: [], idempotencyKey: 'idem-create-003' });
  assert.equal(replay.missionId, first.missionId);
  await assert.rejects(() => plane.createMission({ tenantId, policyId, occurredAt: '2026-09-18T12:00:00.000Z', actor, objective: 'different request', constraints: [], idempotencyKey: 'idem-create-003' }), (error) => error?.code === 'IDEMPOTENCY_CONFLICT');
});


test('policy authorization rejects capability escalation and accepts bounded scopes', async () => {
  const { PolicyAuthorizationEngine } = await import('../dist/index.js');
  const authz = new PolicyAuthorizationEngine();
  authz.register({ policyId, actorTypes: ['AGENT'], allowedCapabilities: ['RepoRead', 'RepoWrite'] });
  const context = authz.authorize({ actor, policyId, requestedCapabilities: ['RepoRead'], expiresAt: '2099-09-18T12:00:00.000Z', decisionId: 'decision-001' });
  assert.equal(context.capabilities[0], 'RepoRead');
  assert.throws(() => authz.authorize({ actor, policyId, requestedCapabilities: ['DeployProduction'], expiresAt: '2099-09-18T12:00:00.000Z', decisionId: 'decision-002' }), /CAPABILITY_NOT_ALLOWED/);
});
