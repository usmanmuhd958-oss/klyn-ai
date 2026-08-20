// =============================================================================
// KLYN AI OS — Phase 14 Smoke Test
// File: 1.brain/smoke.phase14.ts
//
// Run:  bun run smoke:phase14   (or: bun run 1.brain/smoke.phase14.ts)
//
// Covers all Phase 14 capabilities — REAL MESH TRANSPORT (WebSocket + mTLS +
// STUN + gossip + reconnection), SQLITE/WAL PERSISTENCE, HARDENED
// MULTI-TENANT JWT GATEWAY & DEPLOYABLE ARTIFACT/OBSERVABILITY:
//   1. SQLite/WAL ledger — atomic batches, fsync durability across close/
//      reopen, cold-boot recovery timing, engine replay (quantum/learner/
//      policy), SQLite mesh topology store
//   2. Real network transport — RFC 5389 STUN binding round-trip, mTLS
//      handshake (trusted + untrusted), WebSocket frames + dedup, exponential
//      backoff reconnection, gossip discovery, FederatedMesh bridge
//   3. Hardened gateway — Ed25519-signed JWTs, per-tenant key isolation,
//      RBAC (admin/operator/auditor/viewer), /v1/audit/export, token
//      issuance, Prometheus + traces + artifact plan routes
//   4. Profiler telemetry hooks — latency histograms + OTel spans + repair
//      counters wired into the runtime profiler
// =============================================================================
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteLedger, SqliteEnginePersistence } from '../kernel/src/storage/sqlite_ledger.js';
import { MeshStorageSqlite } from '../packages/swarm-mesh/src/mesh_storage_sqlite.js';
import {
  createIdentity,
  WsMeshNode,
  ReconnectingClient,
  GossipDiscovery,
  MeshTransportBridge,
  startMockStunServer,
  stunBindingRequest,
  encodeStunBindingRequest,
  decodeStunResponse,
  encodeStunResponse,
  encodeXorMappedAddress,
} from '../packages/swarm-mesh/src/transports/real_transport.js';
import { GatewayV2, bootstrapGateway, createGatewayV2Router, PHASE14_GATEWAY_ROUTES } from '../api/gateway_v2.js';
import { createPhase9Handler, createRouter, PHASE14_ROUTES, type HeadlessRequest } from '../api/router.js';
import { PrometheusRegistry, OtelTracer } from '../packages/deploy/src/observability.js';
import { ArtifactEngine } from '../packages/deploy/src/artifact.js';
import { RuntimeProfiler } from './runtime_profiler.js';
import { QuantumZkLedger } from '../kernel/src/security/quantum_zk.js';
import { ExperienceLearner } from './experience_learner.js';
import { AdaptivePolicyEngine } from './adaptive_policy.js';
import { TemporalCausality, HybridLogicalClock } from './temporal_causality.js';
import { FederatedMesh } from '../packages/swarm-mesh/src/federated_mesh.js';
import { check, deepEqual, sortDeep, summary } from './smoke/harness.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(condition: () => boolean, timeoutMs = 2_000, intervalMs = 20): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(intervalMs);
  }
  return condition();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) SQLITE/WAL PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────
async function sqliteSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p14-sqlite-'));
  const dbFile = join(dir, 'ledger.sqlite');
  try {
    const ledger = new SqliteLedger(dbFile);
    await ledger.append('quantum', { type: 'mutation', kind: 'patch', ref: 'a.ts', input: 'i1', output: 'o1' });
    await ledger.append('quantum', { type: 'mutation', kind: 'patch', ref: 'b.ts', input: 'i2', output: 'o2' });
    const batch = await ledger.appendBatch('experience', [{ type: 'record', key: 'k1' }, { type: 'record', key: 'k2' }, { type: 'record', key: 'k3' }]);
    check('sqlite: batch assigns contiguous seqs', batch.from === 1 && batch.to === 3, `${batch.from}-${batch.to}`);
    check('sqlite: per-stream isolation', (await ledger.readAll('quantum')).length === 2 && (await ledger.readAll('experience')).length === 3);
    const since = await ledger.readSince('experience', 1);
    check('sqlite: readSince returns only the suffix', since.length === 2 && (since[0] as { key: string }).key === 'k2');
    const last = await ledger.readLast('quantum', 1);
    check('sqlite: readLast newest-first tail', last.length === 1 && (last[0] as { ref: string }).ref === 'b.ts');
    check('sqlite: lastSeq tracks the stream watermark', ledger.lastSeq('experience') === 3 && ledger.lastSeq('quantum') === 2);

    // fsync durability: close, reopen, and the data must be byte-identical.
    ledger.close();
    const reopened = new SqliteLedger(dbFile);
    const events = await reopened.readAll('quantum');
    check('sqlite: fsync durability — data survives close/reopen', events.length === 2 && (events[0] as { ref: string }).ref === 'a.ts', JSON.stringify(events.length));
    check('sqlite: WAL mode active', (reopened.raw.query('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode === 'wal');

    // Cold-boot recovery timing (target < 5ms; assert a CI-safe bound and log).
    const bootStart = performance.now();
    await reopened.readAll('experience');
    const coldBootMs = performance.now() - bootStart;
    check('sqlite: cold-boot recovery fast', coldBootMs < 50, `cold-boot read ${coldBootMs.toFixed(2)}ms`);

    // Engine replay: quantum ledger reproduces byte-exact roots. (Reset the
    // quantum stream first — the durability section wrote 2 events to it.)
    await reopened.reset('quantum');
    const qz = new QuantumZkLedger('p14-master');
    const sqliteP = new SqliteEnginePersistence(reopened);
    await sqliteP.persistQuantumMutation(qz, 'patch', 'x.ts', 'in', 'out');
    qz.commitMutation('patch', 'x.ts', 'in', 'out');
    await sqliteP.persistQuantumMutation(qz, 'state', 'y.ts', 'a', 'b');
    qz.commitMutation('state', 'y.ts', 'a', 'b');
    const qz2 = new QuantumZkLedger('p14-master');
    const restored = await sqliteP.restoreQuantum(qz2);
    check('sqlite: quantum ledger replay restores every record', restored === 2 && qz2.recordCount === 2, `restored=${restored}`);
    check('sqlite: replayed ledger reproduces the SAME merkle root', qz2.root === qz.root && qz2.verify().valid === true, qz2.root.slice(0, 12));

    // Learner + policy replay.
    const learner = new ExperienceLearner();
    await sqliteP.persistLearnerRecord(learner, 'ast', 'parse', true, 12);
    learner.record('ast', 'parse', true, 12);
    await sqliteP.persistLearnerRecord(learner, 'ast', 'parse', false, 30);
    learner.record('ast', 'parse', false, 30);
    const learner2 = new ExperienceLearner();
    const restoredLearner = await sqliteP.restoreLearner(learner2);
    check('sqlite: learner replay restores experience', restoredLearner === 2 && learner2.summarize().experiences === learner.summarize().experiences, `${restoredLearner}/${learner.summarize().experiences}`);

    const policy = new AdaptivePolicyEngine();
    await sqliteP.persistPolicyEvent(policy, { type: 'observe', success: true, latencyMs: 10 });
    policy.observe(true, 10);
    await sqliteP.persistPolicyEvent(policy, { type: 'observe', success: false, latencyMs: 90 });
    policy.observe(false, 90);
    const policy2 = new AdaptivePolicyEngine();
    const restoredPolicy = await sqliteP.restorePolicy(policy2);
    check('sqlite: policy replay restores ordered events', restoredPolicy === 2 && policy2.history().length === policy.history().length && policy2.verifyLedger() === true, `restored=${restoredPolicy} versions=${policy2.history().length}`);
    check('sqlite: streams() deterministic', deepEqual(await reopened.streams(), ['experience', 'policy', 'quantum']), JSON.stringify(await reopened.streams()));

    // SQLite mesh topology store — same surface as the JSON-L MeshStorage.
    const temporal = new TemporalCausality({ nodeId: 'm-a', clock: new HybridLogicalClock('m-a', () => 1000) });
    temporal.snapshot('src/app.ts', 'v0');
    temporal.mutate('src/app.ts', 'v0', 'v1');
    const mesh = new FederatedMesh({ nodeId: 'm-a', temporal });
    mesh.join('peer-1', { address: 'termux:7860', seedHash: 'abc'.repeat(22) });
    mesh.join('peer-2', { address: 'ci:7860' });
    mesh.partition('peer-2');
    const meshStore = new MeshStorageSqlite(reopened);
    await meshStore.persistTopology(mesh.nodes());
    await meshStore.persistReputation('peer-1', 2, true, 3);
    await meshStore.persistVectorClock(temporal.hlc);
    const bootStore = new MeshStorageSqlite(new SqliteLedger(dbFile));
    const peers = await bootStore.restoreTopology();
    check('sqlite: mesh topology survives cold boot', peers.length === 2 && peers.some((p) => p.nodeId === 'peer-1' && p.address === 'termux:7860'), JSON.stringify(peers.map((p) => p.nodeId)));
    const reps = await bootStore.restoreReputations();
    check('sqlite: mesh reputation survives cold boot', reps['peer-1']?.failCount === 2 && reps['peer-1']?.quarantined === true, JSON.stringify(reps['peer-1']));
    const vec = await bootStore.restoreVectorClock();
    check('sqlite: vector clock survives cold boot', vec !== null && vec.counter === temporal.hlc.counter, JSON.stringify(vec));
    const tb = new TemporalCausality({ nodeId: 'm-b' });
    tb.snapshot('src/lib.ts', 'lib0');
    tb.mutate('src/lib.ts', 'lib0', 'lib1');
    const mb = new FederatedMesh({ nodeId: 'm-b', temporal: tb });
    const rediscovery = await bootStore.coldBootRediscovery(mb, tb);
    check('sqlite: cold-boot re-discovery rejoins peers + catch-up bundle', rediscovery.peers.length === 2 && rediscovery.catchUpDelta.length === 2 && rediscovery.vectorClock !== null, `peers=${rediscovery.peers.length}`);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) REAL NETWORK MESH TRANSPORT
// ─────────────────────────────────────────────────────────────────────────────
async function transportSuite(): Promise<void> {
  const nodesToStop: Array<{ close(): void }> = [];
  const stuns: Array<{ stop(): void }> = [];
  try {
    // ── STUN (RFC 5389) wire format + real UDP round-trip ───────────────────
    const txid = Buffer.alloc(12, 7);
    const binding = encodeStunBindingRequest(txid);
    check('transport: STUN binding request header (20 bytes, magic cookie)', binding.length === 20 && binding.readUInt32BE(4) === 0x2112a442 && binding.readUInt16BE(0) === 0x0001);
    const mock = await startMockStunServer('127.0.0.1');
    stuns.push(mock);
    const { mapped, rttMs } = await stunBindingRequest('127.0.0.1', mock.port);
    check('transport: real STUN binding round-trip returns mapped endpoint', mapped.ip === '127.0.0.1' && mapped.port > 0, `${mapped.ip}:${mapped.port} (${rttMs}ms)`);
    const crafted = encodeStunResponse(0x0101, txid, [encodeXorMappedAddress('127.0.0.1', 54321, txid)]);
    const decoded = decodeStunResponse(crafted);
    check('transport: STUN decode XOR-MAPPED-ADDRESS (ipv4)', decoded.type === 0x0101 && decoded.xorMappedAddress?.ip === '127.0.0.1' && decoded.xorMappedAddress?.port === 54321);

    // ── mTLS identities + mutual handshake over real WebSockets ─────────────
    const identA = createIdentity('klyn-a', 'seed-a');
    const identB = createIdentity('klyn-b', 'seed-b');
    const identC = createIdentity('klyn-c', 'seed-c');
    const identRogue = createIdentity('klyn-rogue', 'seed-rogue');
    const trustA = new Map<string, string>([
      ['klyn-b', identB.publicKeyB64],
      ['klyn-c', identC.publicKeyB64],
    ]);
    const trustB = new Map<string, string>([['klyn-a', identA.publicKeyB64]]);

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const nodeA = new WsMeshNode({ nodeId: 'klyn-a', identity: identA, trustStore: trustA, onMessage: (f) => receivedA.push(`${f.from}:${f.kind}:${String((f.payload as { n?: number })?.n ?? '')}`) });
    nodesToStop.push(nodeA);
    await nodeA.start(0);
    const nodeB = new WsMeshNode({ nodeId: 'klyn-b', identity: identB, trustStore: trustB, onMessage: (f) => receivedB.push(`${f.from}:${f.kind}`) });
    nodesToStop.push(nodeB);

    const ok = await nodeB.connect(`ws://127.0.0.1:${nodeA.port}/`, 'klyn-a');
    check('transport: mTLS handshake succeeds for trusted peers', ok === true && nodeA.isConnected('klyn-b') && nodeB.isConnected('klyn-a'), `ok=${ok}`);
    nodeB.send('klyn-a', 'mesh.test', { n: 1 });
    nodeB.send('klyn-a', 'mesh.test', { n: 2 });
    await sleep(150);
    check('transport: frames delivered over the real socket', deepEqual(receivedA, ['klyn-b:mesh.test:1', 'klyn-b:mesh.test:2']), JSON.stringify(receivedA));

    // ── Untrusted peer rejected by mTLS ─────────────────────────────────────
    const trustRogue = new Map<string, string>([['klyn-a', identA.publicKeyB64]]);
    const nodeRogue = new WsMeshNode({ nodeId: 'klyn-rogue', identity: identRogue, trustStore: trustRogue });
    nodesToStop.push(nodeRogue);
    const rejected = await nodeRogue.connect(`ws://127.0.0.1:${nodeA.port}/`, 'klyn-a');
    await sleep(100);
    check('transport: untrusted peer cannot authenticate', rejected === false && nodeA.isConnected('klyn-rogue') === false, `rejected=${rejected}`);

    // ── Bounded dedup over the wire (raw client, same frame id twice) ───────
    const identRaw = createIdentity('klyn-raw', 'seed-raw');
    const trustARaw = new Map<string, string>(trustA);
    trustARaw.set('klyn-raw', identRaw.publicKeyB64);
    const nodeARaw = new WsMeshNode({ nodeId: 'klyn-a-raw', identity: identA, trustStore: trustARaw, onMessage: (f) => rawFrames.push(f) });
    nodesToStop.push(nodeARaw);
    await nodeARaw.start(0);
    const rawFrames: Array<{ id: string; from: string; kind: string }> = [];
    const rawClient = new WebSocket(`ws://127.0.0.1:${nodeARaw.port}/`);
    await new Promise<void>((resolve, reject) => {
      rawClient.onopen = () => rawClient.send(JSON.stringify({ kind: 'klyn.hello', nodeId: 'klyn-raw', nonce: 'n1', sig: identRaw.sign('n1') }));
      rawClient.onmessage = (ev) => {
        const parsed = JSON.parse(String(ev.data));
        if (parsed.kind === 'klyn.hello_ack') resolve();
      };
      rawClient.onerror = () => reject(new Error('raw ws error'));
    });
    const duplicate = { id: 'dup-0001', from: 'klyn-raw', to: 'klyn-a-raw', kind: 'mesh.dup-test', payload: { n: 42 }, at: Date.now() };
    rawClient.send(JSON.stringify(duplicate));
    rawClient.send(JSON.stringify(duplicate));
    rawClient.send(JSON.stringify({ ...duplicate, id: 'dup-0002' }));
    await sleep(150);
    rawClient.close();
    check('transport: duplicate frames deduplicated by id', rawFrames.length === 2 && rawFrames[0].id === 'dup-0001' && rawFrames[1].id === 'dup-0002', `frames=${rawFrames.length} deduped=${nodeARaw.getStats().deduped}`);
    check('transport: dedup counter tracks the drop', nodeARaw.getStats().deduped === 1, String(nodeARaw.getStats().deduped));

    // ── ReconnectingClient: exponential backoff after a network drop ─────────
    const identCli = createIdentity('klyn-cli', 'seed-cli');
    const identSrv = createIdentity('klyn-srv', 'seed-srv');
    const srvReceived: string[] = [];
    const nodeServer = new WsMeshNode({ nodeId: 'klyn-srv', identity: identSrv, trustStore: new Map([['klyn-cli', identCli.publicKeyB64]]), onMessage: (f) => srvReceived.push(f.kind) });
    nodesToStop.push(nodeServer);
    await nodeServer.start(0);
    const cliReceived: string[] = [];
    const statuses: string[] = [];
    const client = new ReconnectingClient({
      identity: identCli,
      trustStore: new Map([['klyn-srv', identSrv.publicKeyB64]]),
      remoteId: 'klyn-srv',
      url: `ws://127.0.0.1:${nodeServer.port}/`,
      onMessage: (f) => cliReceived.push(f.kind),
      onStatus: (s) => statuses.push(s),
      baseMs: 25,
      maxMs: 200,
      jitterMs: 5,
    });
    const started = await client.start();
    check('transport: reconnecting client establishes the link', started === true && nodeServer.isConnected('klyn-cli'), `started=${started}`);
    client.send('mesh.heartbeat', { at: 1 });
    await sleep(100);
    check('transport: client message delivered over the live link', srvReceived.includes('mesh.heartbeat'), JSON.stringify(srvReceived));

    nodeServer.drop('klyn-cli');
    const reconnected = await pollUntil(() => nodeServer.isConnected('klyn-cli'), 2_500, 25);
    check('transport: dropped link auto-reconnects with backoff', reconnected === true && client.getAttempts() >= 1, `attempts=${client.getAttempts()} status=${client.getStatus()}`);
    client.send('mesh.after-reconnect', { at: 2 });
    await sleep(150);
    check('transport: messages flow again after reconnection', srvReceived.includes('mesh.after-reconnect'), JSON.stringify(srvReceived));
    client.stop();

    // ── Gossip discovery: announce, spread, merge, prune ────────────────────
    const gA = new GossipDiscovery('klyn-a', 1_000);
    const gB = new GossipDiscovery('klyn-b', 1_000);
    gA.announce('klyn-b', { address: '10.0.0.2:7860' });
    gA.announce('klyn-c', { seedHash: 'abc' });
    const spread = gA.spread();
    check('transport: gossip spread contains announced members', spread.length === 2 && spread[0].peerId === 'klyn-b' && spread[1].peerId === 'klyn-c');
    const absorbed = gB.merge('klyn-a', spread);
    // spread carries klyn-b (skipped — it IS this node) + klyn-c (absorbed).
    check('transport: gossip merge absorbs foreign members', absorbed === 1 && gB.peers().length === 1 && gB.peers()[0].peerId === 'klyn-c', `absorbed=${absorbed}`);
    const pruned = gA.prune(Date.now() + 10_000);
    check('transport: expired gossip members pruned', pruned === 2 && gA.peers().length === 0, `pruned=${pruned}`);

    // ── MeshTransportBridge: real transport drives FederatedMesh causal sync ─
    const tA = new TemporalCausality({ nodeId: 'bridge-a', clock: new HybridLogicalClock('bridge-a', () => 5000) });
    const tB = new TemporalCausality({ nodeId: 'bridge-b', clock: new HybridLogicalClock('bridge-b', () => 5000) });
    tA.snapshot('src/app.ts', 'v0');
    tA.mutate('src/app.ts', 'v0', 'v1');
    tA.mutate('src/app.ts', 'v1', 'v2');
    const meshA = new FederatedMesh({ nodeId: 'bridge-a', temporal: tA });
    const meshB = new FederatedMesh({ nodeId: 'bridge-b', temporal: tB });
    meshA.join('bridge-b');
    meshB.join('bridge-a');
    const identBa = createIdentity('bridge-a', 'seed-ba');
    const identBb = createIdentity('bridge-b', 'seed-bb');
    const bridgeNodeA = new WsMeshNode({ nodeId: 'bridge-a', identity: identBa, trustStore: new Map([['bridge-b', identBb.publicKeyB64]]) });
    const bridgeNodeB = new WsMeshNode({ nodeId: 'bridge-b', identity: identBb, trustStore: new Map([['bridge-a', identBa.publicKeyB64]]) });
    nodesToStop.push(bridgeNodeA, bridgeNodeB);
    new MeshTransportBridge(meshA, bridgeNodeA).attach();
    new MeshTransportBridge(meshB, bridgeNodeB).attach();
    await bridgeNodeA.start(0);
    const connected = await bridgeNodeB.connect(`ws://127.0.0.1:${bridgeNodeA.port}/`, 'bridge-a');
    check('transport: bridge handshake completes', connected === true);
    // B (fresh) asks A for its causal delta over the real socket:
    bridgeNodeB.send('bridge-a', 'mesh.sync-request', { since: 0 });
    await pollUntil(() => tB.seq >= 3, 1_000, 20);
    check('transport: bridge syncs causal state over the wire', tB.seq === 3 && deepEqual(tB.stateSnapshot(), tA.stateSnapshot()), `B.seq=${tB.seq} A.seq=${tA.seq}`);
  } finally {
    for (const n of nodesToStop) {
      try {
        n.close();
      } catch {
        /* ignore */
      }
    }
    for (const s of stuns) s.stop();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) HARDENED MULTI-TENANT GATEWAY (JWT + RBAC + audit export)
// ─────────────────────────────────────────────────────────────────────────────
async function gatewaySuite(): Promise<void> {
  try {
    const fixedNow = 1_750_000_000_000;
    const gw = new GatewayV2({ adminSeed: 'p14-admin', now: () => fixedNow });
    const adminToken = gw.issueAdminToken();
    const claims = gw.verifyToken(adminToken);
    check('gateway: admin JWT verifies with correct claims', claims !== null && claims.role === 'admin' && claims.sub === 'klyn-admin' && claims.iss === 'klyn-gateway-v2', JSON.stringify(claims));

    const tampered = `${adminToken.slice(0, -2)}AA`;
    check('gateway: tampered token rejected', gw.verifyToken(tampered) === null);
    const garbage = 'not.a.jwt';
    check('gateway: garbage token rejected', gw.verifyToken(garbage) === null);

    // Per-tenant key isolation + role-claim binding.
    const acme = gw.createTenant('acme', 'operator');
    const acmeToken = gw.issueToken('acme');
    const acmeClaims = gw.verifyToken(acmeToken);
    check('gateway: tenant token verifies under its own key', acmeClaims !== null && acmeClaims.sub === 'acme' && acmeClaims.role === 'operator', JSON.stringify(acmeClaims));
    check('gateway: tenants carry isolated public keys', acme.publicKeyB64.length > 40 && acme.publicKeyB64 !== gw.tenant('klyn-admin')?.publicKeyB64);

    // Forge an admin-role claim on acme's token (payload mutated, sig intact):
    const parts = acmeToken.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64url').toString()), role: 'admin', sub: 'klyn-admin' })).toString('base64url');
    check('gateway: role-claim forgery rejected (signature binds payload)', gw.verifyToken(`${parts[0]}.${forgedPayload}.${parts[2]}`) === null);

    // Expiry.
    const expired = new GatewayV2({ adminSeed: 'p14-exp', tokenTtlMs: -1, now: () => fixedNow });
    const expiredToken = expired.issueAdminToken();
    check('gateway: expired token rejected', expired.verifyToken(expiredToken) === null);

    // RBAC matrix.
    check('gateway: RBAC admin is wildcard', gw.hasPermission(acmeClaims!, 'audit:read') && gw.hasPermission(claims!, 'system:admin'));
    const viewerTenant = gw.createTenant('audit-only', 'auditor');
    const auditorToken = gw.issueToken('audit-only');
    const auditorClaims = gw.verifyToken(auditorToken)!;
    check('gateway: auditor can read audits but not write', gw.hasPermission(auditorClaims, 'audit:read') === true && gw.hasPermission(auditorClaims, 'system:write') === false);
    const viewerRec = gw.createTenant('read-only', 'viewer');
    const viewerToken = gw.issueToken('read-only');
    const viewerClaims = gw.verifyToken(viewerToken)!;
    check('gateway: viewer can read system only', gw.hasPermission(viewerClaims, 'system:read') === true && gw.hasPermission(viewerClaims, 'heal:execute') === false);

    // ── Full handler: JWT auth + RBAC on every route ─────────────────────────
    const quantum = new QuantumZkLedger('p14-api');
    quantum.commitMutation('patch', 'src/a.ts', 'in', 'out');
    quantum.commitMutation('state', 'src/b.ts', 'x', 'y');
    const metrics = new PrometheusRegistry();
    metrics.inc('klyn_gateway_tokens_issued', 'JWTs issued by the gateway');
    const tracer = new OtelTracer({ serviceName: 'klyn-test' });
    tracer.startSpan('gateway.probe').end({ ok: true }, 'OK');
    const repoRoot = process.cwd();
    const { handler } = bootstrapGateway({ gateway: gw, quantum, metrics, tracer, repoRoot, token: 'unused-delegate-token' });

    const call = (req: HeadlessRequest) => handler(req);
    const health = await call({ method: 'GET', url: '/v1/health', headers: {} });
    check('gateway: public health without token', health.status === 200 && (health.body as any).data.gateway === 'v2');

    const noAuth = await call({ method: 'GET', url: '/v1/audit/export', headers: {} });
    check('gateway: unauthenticated route rejected 401', noAuth.status === 401, String(noAuth.status));

    const as = (token: string) => ({ authorization: `Bearer ${token}` });

    // auditor → audit export OK; viewer → forbidden.
    const auditExport = await call({ method: 'GET', url: '/v1/audit/export', headers: as(auditorToken) });
    const aData = (auditExport.body as any).data;
    check('gateway: auditor can export the audit chain', auditExport.status === 200 && aData.format === 'klyn-quantum-audit-v1' && aData.records === 2 && aData.verify.valid === true && aData.ledger.length === 2 && aData.perRecord.every((r: { verify: boolean }) => r.verify === true), `records=${aData.records} verify=${aData.verify.valid}`);
    const viewerExport = await call({ method: 'GET', url: '/v1/audit/export', headers: as(viewerToken) });
    check('gateway: viewer forbidden from audit export (403)', viewerExport.status === 403, String(viewerExport.status));

    // Admin issues a token for a NEW tenant through the API.
    const issue = await call({ method: 'POST', url: '/v1/gateway/token', headers: as(adminToken), body: { tenantId: 'api-tenant', role: 'operator' } });
    const iData = (issue.body as any).data;
    check('gateway: admin can mint tenant tokens via API', issue.status === 200 && typeof iData.token === 'string' && iData.tenant.tenantId === 'api-tenant' && iData.tenant.role === 'operator');
    const minted = gw.verifyToken(iData.token);
    check('gateway: minted token verifies + role bound to record', minted !== null && minted.role === 'operator' && minted.sub === 'api-tenant');

    const tenants = await call({ method: 'GET', url: '/v1/gateway/tenants', headers: as(adminToken) });
    const tData = (tenants.body as any).data;
    check('gateway: tenant registry lists tenants (no secrets)', tenants.status === 200 && tData.tenants.some((t: { tenantId: string }) => t.tenantId === 'acme') && tData.tenants.every((t: { publicKeyB64: string }) => typeof t.publicKeyB64 === 'string'));

    // Delegated surface: any valid JWT unlocks earlier-phase routes per RBAC.
    const temporal = await call({ method: 'GET', url: '/v1/temporal/now', headers: as(viewerToken) });
    check('gateway: viewer can read delegated temporal surface', temporal.status === 200 && (temporal.body as any).data.nodeId === 'klyn-headless', String(temporal.status));
    const healForbidden = await call({ method: 'POST', url: '/v1/autonomous/heal', headers: as(viewerToken), body: { source: 'manual' } });
    check('gateway: viewer cannot write (heal → 403)', healForbidden.status === 403, String(healForbidden.status));
    const healBadBody = await call({ method: 'POST', url: '/v1/autonomous/heal', headers: as(acmeToken), body: { source: 'manual' } });
    check('gateway: operator passes RBAC, handler validates (422)', healBadBody.status === 422, `${healBadBody.status} ${JSON.stringify((healBadBody.body as any).error?.code)}`);

    // Observability routes.
    const prom = await call({ method: 'GET', url: '/v1/metrics/prometheus', headers: as(acmeToken) });
    const promText = (prom.body as any).data.metrics as string;
    check('gateway: Prometheus text exposition served', prom.status === 200 && promText.includes('# TYPE klyn_gateway_tokens_issued counter') && promText.includes('klyn_gateway_tokens_issued 1'), promText.split('\n')[2] ?? '');
    const traces = await call({ method: 'GET', url: '/v1/traces', headers: as(acmeToken) });
    const tSpans = (traces.body as any).data.spans as Array<{ name: string; traceId: string; spanId: string }>;
    check('gateway: OTel traces served', traces.status === 200 && tSpans.length === 1 && tSpans[0].name === 'gateway.probe' && tSpans[0].traceId.length === 32 && tSpans[0].spanId.length === 16);

    // Artifact plan — real repo.
    const planRes = await call({ method: 'GET', url: '/v1/artifacts/plan', headers: as(acmeToken) });
    const plan = (planRes.body as any).data;
    check('gateway: artifact plan resolves the real entrypoint', planRes.status === 200 && plan.entry === 'klyn_server.js' && plan.target === 'bun' && plan.verified === true && plan.errors.length === 0, `entry=${plan.entry} verified=${plan.verified} errors=${plan.errors.length}`);
    check('gateway: artifact plan includes manifest + dep pins + compile command', Array.isArray(plan.manifest) && plan.manifest.length >= 2 && typeof plan.deps.express === 'string' && ArtifactEngine.compileCommand(plan).startsWith('bun build ./klyn_server.js'));
    const planRecheck = await ArtifactEngine.verifyPlan(plan, repoRoot);
    check('gateway: artifact plan re-verifies against the live tree', planRecheck === true);

    // Static-token surface also serves audit export (shared core).
    const staticHandler = createPhase9Handler({ token: 'p14-static', quantum });
    const staticExport = await staticHandler({ method: 'GET', url: '/v1/audit/export', headers: { authorization: 'Bearer p14-static' } });
    check('gateway: static-token surface shares the audit export core', staticExport.status === 200 && (staticExport.body as any).data.records === 2);

    // Registries + Express mounts.
    check('gateway: phase14 route registry complete', PHASE14_ROUTES.length === 1 && PHASE14_ROUTES[0] === '/v1/audit/export', PHASE14_ROUTES.join(','));
    check('gateway: gateway route registry complete', PHASE14_GATEWAY_ROUTES.length === 6 && PHASE14_GATEWAY_ROUTES.includes('GET /v1/audit/export') && PHASE14_GATEWAY_ROUTES.includes('POST /v1/gateway/token'), PHASE14_GATEWAY_ROUTES.join(','));
    const expressGateway: any = createGatewayV2Router({ gateway: gw, token: 'x' });
    const mounted = (expressGateway.stack ?? []).map((l: any) => l.route?.path).filter((p: unknown): p is string => typeof p === 'string');
    check('gateway: express gateway router mounts all six routes', PHASE14_GATEWAY_ROUTES.every((r) => mounted.includes(r.split(' ')[1])), mounted.join(','));
    const expressRouter: any = createRouter({ token: 'x' });
    const mountedCore = (expressRouter.stack ?? []).map((l: any) => l.route?.path).filter((p: unknown): p is string => typeof p === 'string');
    check('gateway: express core router mounts /v1/audit/export', mountedCore.includes('/v1/audit/export'));
  } finally {
    /* nothing to clean up */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) PROFILER TELEMETRY HOOKS (Prometheus + OTel)
// ─────────────────────────────────────────────────────────────────────────────
async function telemetrySuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p14-telemetry-'));
  try {
    const file = join(dir, 'handler.ts');
    writeFileSync(file, 'export function handler(input: string): string {\n  return input;\n}\n');
    const metrics = new PrometheusRegistry();
    const tracer = new OtelTracer({ serviceName: 'klyn-telemetry' });
    const profiler = new RuntimeProfiler({
      latencySlaMs: 5,
      cooldownMs: 0,
      windowMs: 60_000,
      telemetry: { metrics, tracer },
    });
    for (let i = 0; i < 10; i++) {
      profiler.record({ route: '/v1/api/bench', latencyMs: 50, memoryDeltaMb: 0, slowQueries: 0, nPlusOne: false, filePath: file });
    }
    const snapshot = metrics.snapshot();
    const hist = snapshot.histograms['klyn_route_latency_ms{route=/v1/api/bench}'];
    check('telemetry: latency histogram recorded', hist !== undefined && hist.count === 10 && hist.sum === 500, JSON.stringify(hist?.count ?? null));
    const counter = snapshot.counters['klyn_profiler_samples_total{route=/v1/api/bench}'];
    check('telemetry: sample counter recorded', counter !== undefined && counter.value === 10, JSON.stringify(counter?.value ?? null));
    const spans = tracer.export();
    check('telemetry: one span per recorded sample', spans.filter((s) => s.name === 'profiler.record').length === 10, String(spans.length));

    const outcome = await profiler.dispatchRepair('/v1/api/bench');
    check('telemetry: SLA repair applied', outcome.applied === true && outcome.gateApproved === true, outcome.error ?? '');
    const after = metrics.snapshot();
    // Labels are sorted alphabetically by the registry: applied < route.
    const repairs = after.counters['klyn_repairs_total{applied=true,route=/v1/api/bench}'];
    check('telemetry: repair counter incremented', repairs !== undefined && repairs.value === 1, JSON.stringify(repairs?.value ?? null));
    const repairSpans = tracer.export().filter((s) => s.name === 'profiler.repair');
    check('telemetry: repair span recorded with status', repairSpans.length === 1 && repairSpans[0].status === 'OK' && repairSpans[0].attributes.applied === true, JSON.stringify(repairSpans[0]?.attributes ?? null));
    check('telemetry: repaired handler actually patched on disk', readFileSync(file, 'utf-8').includes('__klynRouteCache'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 14 SMOKE ===');
  await sqliteSuite();
  await transportSuite();
  await gatewaySuite();
  await telemetrySuite();
  summary(14);
  process.exit(0);
}

await main();
