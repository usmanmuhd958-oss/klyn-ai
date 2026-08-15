// =============================================================================
// KLYN AI OS — Phase 13 Smoke Test
// File: 1.brain/smoke.phase13.ts
//
// Run:  bun run smoke:phase13   (or: bun run 1.brain/smoke.phase13.ts)
//
// Covers all Phase 13 capabilities — QUORUM-GATED EPOCH EXECUTION,
// PERSISTENT MESH TOPOLOGY & SELF-HEALING MESH CONVERGENCE:
//   1. Quorum-Gated Swarm Epoch Loop — the multi-agent epoch can only reach
//      finality (post-quantum + Merkle signing) after a strict BFT quorum;
//      quorum rejection rolls the tree back byte-exact; a rogue agent with
//      an invalid ZK/WOTS proof is quarantined mid-epoch; zero voters
//      fail closed
//   2. Persistent Mesh Topology — JSON-L topology/reputation/vector-clock
//      persistence + cold-boot re-discovery with instant temporal catch-up
//   3. Self-Healing Mesh Convergence — heartbeat partition detection,
//      background convergence loop, verified ZERO data loss on every heal
//   4. Public /v1/mesh/* API — topology, quarantine control, heal triggers
// =============================================================================
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JsonlLedger } from '../kernel/src/storage/persistent_ledger.js';
import { TemporalCausality, HybridLogicalClock } from './temporal_causality.js';
import { FederatedMesh } from '../packages/swarm-mesh/src/federated_mesh.js';
import { MeshStorage } from '../packages/swarm-mesh/src/mesh_storage.js';
import { MeshHealer } from '../packages/swarm-mesh/src/mesh_healer.js';
import { ConsensusIsolation } from './consensus_isolation.js';
import { QuorumEpochLoop } from './swarm/QuorumEpochLoop.js';
import { QuantumZkLedger } from '../kernel/src/security/quantum_zk.js';
import MerkleAudit from '../kernel/src/security/merkle_audit.js';
import { ExperienceLearner } from './experience_learner.js';
import { AdaptivePolicyEngine } from './adaptive_policy.js';
import type { EpochFinding } from './e2e_autonomous_epoch.js';
import { createPhase9Handler, createRouter, PHASE13_ROUTES } from '../api/router.js';
import type { HeadlessRequest } from '../api/router.js';

let failures = 0;
let passes = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passes++;
    console.log(`PASS  ${name}${detail ? `  → ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? `  → ${detail}` : ''}`);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortDeep((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

function engine(nodeId: string, wall: number): TemporalCausality {
  return new TemporalCausality({ nodeId, clock: new HybridLogicalClock(nodeId, () => wall) });
}

function epochFinding(filePath: string): EpochFinding {
  return { source: 'profiler', route: '/v1/api/bench', filePath, detail: 'latency SLA breach', kind: 'latency', severity: 'latency', at: Date.now() };
}

const HANDLER = `export function handler(input: string): string {\n  return input;\n}\n`;

// ─────────────────────────────────────────────────────────────────────────────
// 1) QUORUM-GATED SWARM EPOCH LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function quorumEpochSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p13-quorum-'));
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    const fileA = join(dir, 'src', 'a.ts');
    const fileB = join(dir, 'src', 'b.ts');
    const fileC = join(dir, 'src', 'c.ts');
    const fileD = join(dir, 'src', 'd.ts');
    writeFileSync(fileA, HANDLER);
    writeFileSync(fileB, HANDLER);
    writeFileSync(fileC, HANDLER);
    writeFileSync(fileD, HANDLER);
    const originalA = HANDLER;

    const voters = ['v1', 'v2', 'v3', 'v4', 'v5'];
    const shared = {
      quantum: new QuantumZkLedger('p13-master'),
      merkle: new MerkleAudit(),
      learner: new ExperienceLearner(),
      policy: new AdaptivePolicyEngine(),
    };

    // ── Honest quorum: swarm epoch + BFT gate both approve → finality ───────
    const consensus = new ConsensusIsolation({ nodeId: 'epoch-node', quorumSize: 5 });
    const loop = new QuorumEpochLoop({ consensus, voters, ...shared });
    const okOutcome = await loop.drive(epochFinding(fileA), dir);
    check('quorum: swarm epoch ran all four agents', okOutcome.swarmVotes.length === 4 && okOutcome.swarmVotes.every((v) => v.approved), `votes=${okOutcome.swarmVotes.length}`);
    check('quorum: BFT quorum approved the epoch', okOutcome.quorum.committed === true && okOutcome.quorum.approvals === 5, `approvals=${okOutcome.quorum.approvals}`);
    check('quorum: approved epoch reached finality (quantum + merkle)', okOutcome.committed === true && okOutcome.quantumSeq !== null && okOutcome.quantumSeq > 0 && typeof okOutcome.merkleRoot === 'string' && okOutcome.merkleRoot.length === 64, `quantumSeq=${okOutcome.quantumSeq}`);
    check('quorum: code altered on disk only after quorum finality', readFileSync(fileA, 'utf-8') !== originalA);

    // ── Quorum rejection: f >= n/2 Byzantine voters → byte-exact rollback ────
    const consensusFail = new ConsensusIsolation({ nodeId: 'epoch-fail', quorumSize: 5 });
    const loopFail = new QuorumEpochLoop({ consensus: consensusFail, voters, malicious: ['v3', 'v4', 'v5'], ...shared });
    const failOutcome = await loopFail.drive(epochFinding(fileB), dir);
    check('quorum: Byzantine majority blocks the epoch', failOutcome.committed === false && failOutcome.quorum.approvals === 2 && failOutcome.quantumSeq === null && failOutcome.merkleRoot === null, `approvals=${failOutcome.quorum.approvals}`);
    check('quorum: rejected epoch rolled back byte-exact (no unapproved mutation)', failOutcome.rolledBack === true && readFileSync(fileB, 'utf-8') === originalA);

    // ── Byzantine agent: tampered proposal mid-commit → immediate quarantine ─
    const consensusRogue = new ConsensusIsolation({ nodeId: 'epoch-rogue', quorumSize: 5 });
    const loopRogue = new QuorumEpochLoop({
      consensus: consensusRogue,
      voters,
      ...shared,
      tamper: (p) => ({ ...p, output: `${p.output}\n// rogue agent injected\n` }),
    });
    const rogueOutcome = await loopRogue.drive(epochFinding(fileC), dir);
    check('quorum: rogue tamper fails WOTS+/ZK verification', rogueOutcome.committed === false && rogueOutcome.rolledBack === true, rogueOutcome.errors.join('; '));
    check('quorum: rogue agent quarantined mid-epoch', rogueOutcome.quarantined === 'klyn-epoch' && consensusRogue.isQuarantined('klyn-epoch') === true, String(rogueOutcome.quarantined));
    check('quorum: quarantine visible in loop stats', loopRogue.getStats().quarantined.includes('klyn-epoch'));
    check('quorum: rogue epoch left the tree untouched', readFileSync(fileC, 'utf-8') === originalA);

    // ── Fail-closed: zero federated voters → epoch cannot commit ─────────────
    // (on a FRESH file — fileA was already mutated by the first drive)
    const consensusClosed = new ConsensusIsolation({ nodeId: 'epoch-closed', quorumSize: 5 });
    const loopClosed = new QuorumEpochLoop({ consensus: consensusClosed, voters: [], ...shared });
    const closedOutcome = await loopClosed.drive(epochFinding(fileD), dir);
    check('quorum: unfederated cluster fails closed (no quorum possible)', closedOutcome.committed === false && closedOutcome.rolledBack === true && closedOutcome.errors.some((e) => e.includes('quorum')), closedOutcome.errors.join('; '));
    check('quorum: fail-closed does NOT mark the proposer suspicious', consensusClosed.isQuarantined('klyn-epoch') === false && consensusClosed.suspicionOf('klyn-epoch') === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PERSISTENT MESH TOPOLOGY & STATE RECOVERY
// ─────────────────────────────────────────────────────────────────────────────
async function meshStorageSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p13-storage-'));
  try {
    const ta = engine('store-a', 1000);
    ta.snapshot('src/app.ts', 'v0');
    ta.mutate('src/app.ts', 'v0', 'v1');
    const ma = new FederatedMesh({ nodeId: 'store-a', temporal: ta });
    ma.join('peer-1', { address: 'termux:7860', seedHash: 'abc'.repeat(22) });
    ma.join('peer-2', { address: 'ci:7860' });
    ma.partition('peer-2');

    const storage = new MeshStorage(new JsonlLedger(join(dir, 'ledger')));
    await storage.persistTopology(ma.nodes());
    await storage.persistReputation('peer-1', 2, true, 3);
    await storage.persistVectorClock(ta.hlc);

    // ── Cold boot: a fresh process view must reproduce the cluster ───────────
    const bootStorage = new MeshStorage(new JsonlLedger(join(dir, 'ledger')));
    const peers = await bootStorage.restoreTopology();
    check('storage: cold boot restores the full peer table', peers.length === 2 && peers.some((p) => p.nodeId === 'peer-1' && p.address === 'termux:7860') && peers.some((p) => p.nodeId === 'peer-2'), JSON.stringify(peers.map((p) => p.nodeId)));
    const reps = await bootStorage.restoreReputations();
    check('storage: reputation survives the restart', reps['peer-1']?.failCount === 2 && reps['peer-1']?.quarantined === true && reps['peer-1']?.suspicion === 3, JSON.stringify(reps['peer-1']));
    const vec = await bootStorage.restoreVectorClock();
    check('storage: vector clock survives the restart', vec !== null && vec.wall === ta.hlc.wall && vec.counter === ta.hlc.counter && vec.nodeId === ta.hlc.nodeId, JSON.stringify(vec));

    // ── Cold-boot re-discovery: fresh node rejoins + catches up instantly ────
    const tb = engine('store-b', 2000);
    tb.snapshot('src/lib.ts', 'lib0');
    tb.mutate('src/lib.ts', 'lib0', 'lib1');
    const mb = new FederatedMesh({ nodeId: 'store-b', temporal: tb });
    const rediscovery = await bootStorage.coldBootRediscovery(mb, tb);
    check('storage: re-discovery rejoins every persisted peer', rediscovery.peers.length === 2 && mb.nodes().length === 2 && mb.peer('peer-1')?.address === 'termux:7860', `peers=${mb.nodes().length}`);
    check('storage: re-discovery provides the instant temporal catch-up bundle', rediscovery.catchUpDelta.length === 2 && rediscovery.catchUpDelta[0].seq === 1, `delta=${rediscovery.catchUpDelta.length}`);
    check('storage: re-discovery restores reputation + vector clock', rediscovery.reputations['peer-1']?.quarantined === true && rediscovery.vectorClock !== null && rediscovery.vectorClock.counter === ta.hlc.counter);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) SELF-HEALING MESH CONVERGENCE ENGINE
// ─────────────────────────────────────────────────────────────────────────────
async function healerSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p13-healer-'));
  try {
    const storage = new MeshStorage(new JsonlLedger(join(dir, 'ledger')));

    // ── Partition detection: silent peers are marked partitioned ────────────
    const tm = engine('monitor', 3000);
    const mm = new FederatedMesh({ nodeId: 'monitor', temporal: tm });
    mm.join('ghost', { address: 'lost-node:7860' });
    const healer = new MeshHealer(mm, storage, { heartbeatTimeoutMs: 5_000, now: () => Date.now() + 10_000 });
    const actions = healer.tick();
    check('healer: silent peer marked partitioned', actions.length === 1 && actions[0].action === 'partitioned' && actions[0].peer === 'ghost' && mm.peer('ghost')!.status === 'partitioned', JSON.stringify(actions));
    check('healer: pending() lists isolated peers', deepEqual(healer.pending(), ['ghost']), JSON.stringify(healer.pending()));

    // ── Convergence on reconnection with ZERO data loss ──────────────────────
    const tc = engine('heal-c', 5000);
    const td = engine('heal-d', 5000);
    tc.snapshot('src/app.ts', 'v0');
    td.snapshot('src/app.ts', 'v0');
    const mc = new FederatedMesh({ nodeId: 'heal-c', temporal: tc });
    const md = new FederatedMesh({ nodeId: 'heal-d', temporal: td });
    mc.join('heal-d');
    md.join('heal-c');
    const healerC = new MeshHealer(mc, storage);
    const healerD = new MeshHealer(md, storage);
    tc.mutate('src/app.ts', 'v0', 'vA');
    td.mutate('src/app.ts', 'v0', 'vB');

    const healC = await healerC.reconnect('heal-d', md.engine.deltaSince(0));
    const healD = await healerD.reconnect('heal-c', mc.engine.deltaSince(0));
    check('healer: reconnection triggers convergence on both sides', healC.action.action === 'converged' && healD.action.action === 'converged', `${healC.action.action}/${healD.action.action}`);
    check('healer: ZERO DATA LOSS verified on every heal', healC.verification.noDataLoss === true && healC.verification.lostIds.length === 0 && healC.verification.mergedEvents === 4, `merged=${healC.verification.mergedEvents}`);
    check('healer: healed replicas converge to identical state', deepEqual(mc.engine.stateSnapshot(), md.engine.stateSnapshot()), JSON.stringify(mc.engine.stateSnapshot()));
    check('healer: concurrent mutation resolved deterministically', mc.engine.stateSnapshot()['src/app.ts'] === 'vB');
    check('healer: healer stats record the convergence', healerC.getStats().convergences === 1);

    // ── Background convergence loop (parallel, per-peer) ─────────────────────
    const te = engine('heal-e', 6000);
    const me = new FederatedMesh({ nodeId: 'heal-e', temporal: te });
    me.join('heal-c');
    me.join('heal-d');
    const healerE = new MeshHealer(me, storage);
    const verifications = await healerE.convergeAll([
      { peer: 'heal-c', delta: mc.engine.deltaSince(0) },
      { peer: 'heal-d', delta: md.engine.deltaSince(0) },
    ]);
    check('healer: background loop converges every reconnected peer', verifications.length === 2 && verifications.every((v) => v.noDataLoss === true), verifications.map((v) => `${v.peer}:${v.mergedEvents}`).join(' | '));

    // ── Persistence hook: healed topology survives ───────────────────────────
    await healerE.persist();
    const bootStorage = new MeshStorage(new JsonlLedger(join(dir, 'ledger')));
    const persisted = await bootStorage.restoreTopology();
    check('healer: healed topology persists for the next cold boot', persisted.length === 2 && persisted.some((p) => p.nodeId === 'heal-c'), JSON.stringify(persisted.map((p) => p.nodeId)));
    const vec = await bootStorage.restoreVectorClock();
    check('healer: vector clock persisted after convergence', vec !== null && vec.nodeId === 'heal-e');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) PUBLIC AUTHENTICATED API (/v1/mesh/*)
// ─────────────────────────────────────────────────────────────────────────────
async function apiSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p13-api-'));
  try {
    const temporal = engine('api-mesh', 9_000_000);
    temporal.snapshot('src/app.ts', 'v0');
    temporal.mutate('src/app.ts', 'v0', 'v1');
    const mesh = new FederatedMesh({ nodeId: 'api-mesh', temporal });
    mesh.join('peer-1', { address: 'termux:7860' });
    const storage = new MeshStorage(new JsonlLedger(join(dir, 'ledger')));
    await storage.persistTopology(mesh.nodes());
    await storage.persistVectorClock(temporal.hlc);
    const healer = new MeshHealer(mesh, storage);
    const consensus = new ConsensusIsolation({ nodeId: 'api-mesh', quorumSize: 5 });

    const handler = createPhase9Handler({ temporal, mesh, meshStorage: storage, meshHealer: healer, consensus, token: 'p13-token' });
    const call = (req: HeadlessRequest) => handler(req);

    const unauth = await call({ method: 'GET', url: '/v1/mesh/topology', headers: {} });
    check('api: unauthenticated mesh route rejected 401', unauth.status === 401, String(unauth.status));

    const auth = { authorization: 'Bearer p13-token' };

    // ── /v1/mesh/topology ────────────────────────────────────────────────────
    const topo = await call({ method: 'GET', url: '/v1/mesh/topology', headers: auth });
    const tData = (topo.body as any).data;
    check('api: mesh/topology returns durable cluster view', topo.status === 200 && tData.nodeId === 'api-mesh' && tData.peers.length === 1 && tData.peers[0].nodeId === 'peer-1' && tData.stats.peers === 1 && tData.vectorClock !== null && tData.consensus.quorumSize === 5, JSON.stringify(tData.stats));

    // ── /v1/mesh/quarantine ──────────────────────────────────────────────────
    const q1 = await call({ method: 'POST', url: '/v1/mesh/quarantine', headers: auth, body: { nodeId: 'evil', action: 'quarantine' } });
    check('api: mesh/quarantine isolates a node', q1.status === 200 && (q1.body as any).data.quarantined === true && (q1.body as any).data.quarantinedList.includes('evil'));
    const inspect = await call({ method: 'POST', url: '/v1/mesh/quarantine', headers: auth, body: { action: 'inspect' } });
    const iData = (inspect.body as any).data;
    check('api: mesh/quarantine inspects isolation state', inspect.status === 200 && iData.quarantined.includes('evil') && iData.suspicion.evil === 3, JSON.stringify(iData));
    const admit = await call({ method: 'POST', url: '/v1/mesh/quarantine', headers: auth, body: { nodeId: 'evil', action: 'admit' } });
    check('api: mesh/quarantine re-admits a node', admit.status === 200 && (admit.body as any).data.quarantined === false);
    const qBad = await call({ method: 'POST', url: '/v1/mesh/quarantine', headers: auth, body: { nodeId: 'x', action: 'quarantine' } });
    // quarantine('x') is fine — but a missing nodeId must 422
    const qNoNode = await call({ method: 'POST', url: '/v1/mesh/quarantine', headers: auth, body: { action: 'quarantine' } });
    check('api: mesh/quarantine without nodeId rejected 422', qBad.status === 200 && qNoNode.status === 422, `${qBad.status}/${qNoNode.status}`);

    // ── /v1/mesh/heal ────────────────────────────────────────────────────────
    const healEmpty = await call({ method: 'POST', url: '/v1/mesh/heal', headers: auth, body: {} });
    const hData = (healEmpty.body as any).data;
    check('api: mesh/heal sweep reports monitoring actions + pending', healEmpty.status === 200 && Array.isArray(hData.actions) && Array.isArray(hData.pending) && hData.stats.nodes.length === 1);
    const healPeer = await call({ method: 'POST', url: '/v1/mesh/heal', headers: auth, body: { peer: 'peer-1', delta: [] } });
    const hpData = (healPeer.body as any).data;
    check('api: mesh/heal converges a reconnecting peer with zero data loss', healPeer.status === 200 && hpData.verification.noDataLoss === true && hpData.action.action === 'converged', JSON.stringify(hpData.verification));

    // ── Rate limiting + registry + Express mount ─────────────────────────────
    const rl = createPhase9Handler({ token: 'rl-token', rateLimit: { max: 2 } });
    const r1 = await rl({ method: 'GET', url: '/v1/mesh/topology', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    const r2 = await rl({ method: 'GET', url: '/v1/mesh/topology', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    const r3 = await rl({ method: 'GET', url: '/v1/mesh/topology', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    check('api: mesh routes rate limited (429 after cap)', r1.status === 200 && r2.status === 200 && r3.status === 429, `${r1.status}/${r2.status}/${r3.status}`);
    check('api: phase13 route registry complete', PHASE13_ROUTES.length === 3 && PHASE13_ROUTES.includes('/v1/mesh/heal'), PHASE13_ROUTES.join(','));

    const expressRouter: any = createRouter({ token: 'x' });
    const mounted = (expressRouter.stack ?? []).map((l: any) => l.route?.path).filter((p: unknown): p is string => typeof p === 'string');
    check('api: express router mounts all three phase-13 routes', PHASE13_ROUTES.every((p) => mounted.includes(p)), mounted.join(','));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 13 SMOKE ===');
  await quorumEpochSuite();
  await meshStorageSuite();
  await healerSuite();
  await apiSuite();
  console.log(`\n=== PHASE 13 SMOKE SUMMARY: ${passes}/${passes + failures} checks passed ===`);
  if (failures > 0) process.exit(1);
}

await main();
