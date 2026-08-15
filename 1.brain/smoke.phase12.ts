// =============================================================================
// KLYN AI OS — Phase 12 Smoke Test
// File: 1.brain/smoke.phase12.ts
//
// Run:  bun run smoke:phase12   (or: bun run 1.brain/smoke.phase12.ts)
//
// Covers all Phase 12 capabilities — FEDERATED REPLICA SWARM, LOCK-FREE BFT
// CONSENSUS ISOLATION & ULTRA-LOW LATENCY BENCHMARKING:
//   1. Federated Mesh — multi-node federation, minimal causal delta
//      exchange (Phase 11 HLC), idempotent sync, deterministic split-brain
//      partition healing with zero data loss
//   2. Consensus Isolation — WOTS+ + ZK-verified proposals, majority quorum
//      (Byzantine tolerance f < n/2), forgery/tamper rejection, malicious
//      proposer quarantine + re-admission, lock-free idempotent verdicts
//   3. Latency Suite — sub-ms budgets (graph <10ms, rewind <5ms, seed
//      <20ms, CRDT merge <2ms) and 10,000 ops/sec stress floors
//   4. Public /v1/federation/* + /v1/benchmarks/run API — token auth +
//      rate limiting (headless handler + Express mount)
// =============================================================================
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TemporalCausality, HybridLogicalClock } from './temporal_causality.js';
import { FederatedMesh } from '../packages/swarm-mesh/src/federated_mesh.js';
import { ConsensusIsolation, type ConsensusProposal } from './consensus_isolation.js';
import { QuantumZkLedger } from '../kernel/src/security/quantum_zk.js';
import { QualityGate } from '../packages/self-healing-runtime/src/mutation_harness.js';
import { runLatencySuite } from './benchmarks/latency_suite.js';
import { createPhase9Handler, createRouter, PHASE12_ROUTES } from '../api/router.js';
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

/** Order-insensitive deep equality (JSON stringify is insertion-order
 *  sensitive, so objects are normalized with sorted keys first). */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Engine factory with a FIXED physical clock so split-brain events from
 *  different nodes carry concurrent (wall, counter) stamps. */
function engine(nodeId: string, wall: number): TemporalCausality {
  return new TemporalCausality({ nodeId, clock: new HybridLogicalClock(nodeId, () => wall) });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) FEDERATED REPLICA SWARM
// ─────────────────────────────────────────────────────────────────────────────
async function federationSuite(): Promise<void> {
  // ── Linear catch-up: two nodes exchange minimal deltas and converge ──────
  const ta = engine('a', 1000);
  const tb = engine('b', 1000);
  ta.snapshot('src/app.ts', 'v0');
  ta.mutate('src/app.ts', 'v0', 'v1');
  tb.snapshot('src/lib.ts', 'lib0');
  const ma = new FederatedMesh({ nodeId: 'a', temporal: ta });
  const mb = new FederatedMesh({ nodeId: 'b', temporal: tb });
  ma.join('b', { address: 'termux:7860' });
  mb.join('a');

  const r1 = mb.receiveDelta('a', ma.produceDelta(0));
  check('mesh: replica B ingests A\'s causal delta', r1.applied === 2 && mb.getStats().localSeq === 3, `applied=${r1.applied}`);
  const r2 = ma.receiveDelta('b', mb.produceDelta(0));
  check('mesh: replica A dedupes its own events, applies B\'s', r2.applied === 1 && ma.getStats().localSeq === 3, `applied=${r2.applied}`);
  check('mesh: both replicas converge to identical state', deepEqual(ma.engine.stateSnapshot(), mb.engine.stateSnapshot()) && ma.engine.stateSnapshot()['src/lib.ts'] === 'lib0', JSON.stringify(ma.engine.stateSnapshot()));
  check('mesh: re-sync is idempotent (zero applied)', ma.receiveDelta('b', mb.produceDelta(0)).applied === 0);
  const peerB = ma.peer('b');
  check('mesh: peer registry tracks last-seen seq + liveness', peerB !== null && peerB.status === 'online' && peerB.lastSeq === 3 && peerB.address === 'termux:7860', JSON.stringify(peerB));

  // ── Split brain: partition, concurrent divergence, deterministic heal ────
  const tc = engine('c', 5000);
  const td = engine('d', 5000);
  tc.snapshot('src/app.ts', 'v0');
  td.snapshot('src/app.ts', 'v0');
  const mc = new FederatedMesh({ nodeId: 'c', temporal: tc });
  const md = new FederatedMesh({ nodeId: 'd', temporal: td });
  mc.join('d');
  md.join('c');
  mc.partition('d');
  md.partition('c');
  check('mesh: partition marks the peer unreachable', mc.peer('d')!.status === 'partitioned' && md.peer('c')!.status === 'partitioned');

  tc.mutate('src/app.ts', 'v0', 'vA'); // concurrent with d's mutation
  td.mutate('src/app.ts', 'v0', 'vB');
  const heal = FederatedMesh.convergesAfterHeal(mc, md, mc.produceDelta(0), md.produceDelta(0));
  check('mesh: split-brain heal merges BOTH branches (zero data loss)', heal.receiptA.merged === true && heal.receiptB.merged === true && mc.getStats().localSeq === 4 && md.getStats().localSeq === 4, `a=${mc.getStats().localSeq} b=${md.getStats().localSeq}`);
  check('mesh: healed replicas converge to identical state', deepEqual(heal.stateA, heal.stateB), JSON.stringify(heal.stateA));
  check('mesh: concurrent same-ref mutations resolve deterministically', heal.stateA['src/app.ts'] === 'vB', heal.stateA['src/app.ts']);
  const idsA = mc.engine.logSnapshot().map((e) => e.id);
  check('mesh: healed union has unique event ids (no overwrite)', idsA.length === 4 && new Set(idsA).size === 4);
  check('mesh: heal restores connectivity', mc.peer('d')!.status === 'online' && md.peer('c')!.status === 'online');
  const stats = mc.getStats();
  check('mesh: stats count exchanges + heals', stats.exchanges >= 1 && stats.heals === 1, JSON.stringify(stats));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) LOCK-FREE BFT CONSENSUS ISOLATION
// ─────────────────────────────────────────────────────────────────────────────
async function consensusSuite(): Promise<void> {
  const consensus = new ConsensusIsolation({ nodeId: 'c0', quorumSize: 5, quantum: new QuantumZkLedger('p12-master'), gate: new QualityGate() });
  const voters = ['v1', 'v2', 'v3', 'v4', 'v5'];
  const base = { proposer: 'c0', kind: 'patch' as const, ref: 'src/app.ts', input: 'export const v = 0;\n' };

  // ── Honest quorum ─────────────────────────────────────────────────────────
  const round1 = await consensus.runQuorum({ ...base, output: 'export const v = 1;\n' }, voters, []);
  check('consensus: honest proposal passes WOTS+ + ZK + gate verification', consensus.verify(round1.proposal).ok === true);
  check('consensus: unanimous honest quorum commits', round1.result.committed === true && round1.result.approvals === 5 && round1.result.committedBy.length === 5, `approvals=${round1.result.approvals}`);

  // ── Byzantine tolerance: f < n/2 can never block a valid mutation ─────────
  const round2 = await consensus.runQuorum({ ...base, output: 'export const v = 2;\n' }, voters, ['v5']);
  check('consensus: 1 malicious voter (f=1) cannot block commit', round2.result.committed === true && round2.result.approvals === 4 && round2.result.rejectedBy.includes('v5'), `approvals=${round2.result.approvals}`);
  const round3 = await consensus.runQuorum({ ...base, output: 'export const v = 3;\n' }, voters, ['v3', 'v4', 'v5']);
  check('consensus: f >= n/2 Byzantine voters fail the quorum (BFT bound)', round3.result.committed === false && round3.result.approvals === 2, `approvals=${round3.result.approvals}`);

  // ── Forgery & tamper resistance ───────────────────────────────────────────
  const forged = consensus.propose({ ...base, output: 'export const v = 9;\n' }, 'p12-secret');
  const tampered: ConsensusProposal = { ...forged, output: 'export const v = 999;\n' };
  const tv = consensus.verify(tampered);
  check('consensus: content tamper breaks the id binding', !tv.ok && tv.reasons.some((r) => r.includes('id does not match')), tv.reasons.join(';'));
  const sigTampered: ConsensusProposal = { ...forged, signature: [...forged.signature.slice(0, -1), '0'.repeat(64)] };
  check('consensus: WOTS+ signature tamper rejected', !consensus.verify(sigTampered).ok);
  const zkTampered: ConsensusProposal = { ...forged, zk: { ...forged.zk, statement: 'attacker-rebound' } };
  check('consensus: ZK proof rebinding rejected', !consensus.verify(zkTampered).ok && consensus.verify(zkTampered).reasons.some((r) => r.includes('statement')));
  const honestCheck = consensus.verify(forged);
  check('consensus: untampered proposal still verifies', honestCheck.ok === true);

  // ── Malicious proposer quarantine + re-admission ──────────────────────────
  const evil = { proposer: 'evil', kind: 'patch' as const, ref: 'src/app.ts', input: 'x' };
  for (let i = 0; i < 3; i++) {
    await consensus.runQuorum({ ...evil, output: `function broken(${i} {` }, voters, []); // gate-rejected
  }
  check('consensus: repeated gate-failing proposals quarantine the proposer', consensus.isQuarantined('evil') && consensus.suspicionOf('evil') === 3, `suspicion=${consensus.suspicionOf('evil')}`);
  check('consensus: quarantine shows in cluster stats', consensus.getStats().quarantined.includes('evil'));
  let threw = false;
  try {
    consensus.propose({ ...evil, output: 'export const ok = 1;\n' }, 'p12-secret');
  } catch {
    threw = true;
  }
  check('consensus: quarantined proposer can no longer inject', threw === true);
  consensus.admit('evil');
  check('consensus: admit() clears the quarantine', consensus.isQuarantined('evil') === false);
  const round4 = await consensus.runQuorum({ ...base, proposer: 'evil', output: 'export const v = 4;\n' }, voters, []);
  check('consensus: re-admitted proposer commits normally', round4.result.committed === true, `approvals=${round4.result.approvals}`);

  // ── Lock-free: verdicts are pure, idempotent functions of the votes ───────
  const replay = consensus.result(round2.proposal.id)!;
  check('consensus: repeated result reads are stable (no locks, no drift)', replay.committed === round2.result.committed && deepEqual(replay.committedBy, round2.result.committedBy));
  const duplicate = consensus.castVote(round2.proposal.id, 'v1', true);
  check('consensus: double voting is ignored (first write wins)', duplicate === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) ULTRA-LOW LATENCY BENCHMARK SUITE
// ─────────────────────────────────────────────────────────────────────────────
async function benchmarkSuite(): Promise<void> {
  const report = await runLatencySuite();
  check('bench: full latency suite passes all budgets', report.passed === true);
  check('bench: suite shape (4 benches + 2 stress runs)', report.benches.length === 4 && report.stress.length === 2, `benches=${report.benches.length} stress=${report.stress.length}`);
  const graph = report.benches.find((b) => b.name.startsWith('graph'))!;
  check('bench: AST graph traversal under 10ms budget', graph.budgetMs === 10 && graph.passed, `median=${graph.medianMs.toFixed(3)}ms`);
  const rewind = report.benches.find((b) => b.name.startsWith('temporal'))!;
  check('bench: time-travel rewind under 5ms budget', rewind.budgetMs === 5 && rewind.passed, `median=${rewind.medianMs.toFixed(3)}ms`);
  const seed = report.benches.find((b) => b.name.startsWith('replicate'))!;
  check('bench: seed verification under 20ms budget', seed.budgetMs === 20 && seed.passed, `median=${seed.medianMs.toFixed(3)}ms`);
  const sync = report.benches.find((b) => b.name.startsWith('sync'))!;
  check('bench: CRDT state sync under 2ms budget', sync.budgetMs === 2 && sync.passed, `median=${sync.medianMs.toFixed(3)}ms`);
  check('bench: both stress loads sustain 10k+ ops/sec', report.stress.every((s) => s.ops === 10_000 && s.opsPerSec >= 10_000), report.stress.map((s) => `${s.opsPerSec} ops/sec`).join(' | '));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) PUBLIC AUTHENTICATED API (/v1/federation/* + /v1/benchmarks/run)
// ─────────────────────────────────────────────────────────────────────────────
async function apiSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p12-api-'));
  try {
    const temporal = engine('api-mesh', 9_000_000);
    temporal.snapshot('src/app.ts', 'v0');
    temporal.mutate('src/app.ts', 'v0', 'v1');
    const mesh = new FederatedMesh({ nodeId: 'api-mesh', temporal });
    mesh.join('peer-1', { address: 'termux:7860' });

    const handler = createPhase9Handler({ temporal, mesh, token: 'p12-token' });
    const call = (req: HeadlessRequest) => handler(req);

    // ── Authorization ────────────────────────────────────────────────────────
    const unauth = await call({ method: 'GET', url: '/v1/federation/nodes', headers: {} });
    check('api: unauthenticated federation route rejected 401', unauth.status === 401, String(unauth.status));

    const auth = { authorization: 'Bearer p12-token' };

    // ── /v1/federation/nodes ─────────────────────────────────────────────────
    const nodes = await call({ method: 'GET', url: '/v1/federation/nodes', headers: auth });
    const nData = (nodes.body as any).data;
    check('api: federation/nodes lists live cluster peers', nodes.status === 200 && nData.nodeId === 'api-mesh' && nData.stats.peers === 1 && nData.nodes[0].nodeId === 'peer-1' && nData.nodes[0].address === 'termux:7860', JSON.stringify(nData.stats));

    // ── /v1/federation/sync ──────────────────────────────────────────────────
    const syncIn = await call({ method: 'POST', url: '/v1/federation/sync', headers: auth, body: { peer: 'peer-1', delta: [] } });
    check('api: federation/sync ingests a peer delta', syncIn.status === 200 && (syncIn.body as any).data.applied === 0, JSON.stringify((syncIn.body as any).data));
    const syncOut = await call({ method: 'POST', url: '/v1/federation/sync', headers: auth, body: {} });
    const sData = (syncOut.body as any).data;
    check('api: federation/sync produces the causal catch-up bundle', syncOut.status === 200 && sData.delta.length === 2 && sData.peers.includes('peer-1'), `delta=${sData.delta?.length}`);

    // ── /v1/benchmarks/run ───────────────────────────────────────────────────
    const bench = await call({ method: 'GET', url: '/v1/benchmarks/run', headers: auth });
    const bData = (bench.body as any).data;
    check('api: benchmarks/run executes the live latency suite', bench.status === 200 && bData.passed === true && bData.benches.length === 4 && bData.stress.length === 2, `passed=${bData.passed}`);

    // ── Rate limiting + registry + Express mount ─────────────────────────────
    const rl = createPhase9Handler({ token: 'rl-token', rateLimit: { max: 2 } });
    const r1 = await rl({ method: 'GET', url: '/v1/federation/nodes', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    const r2 = await rl({ method: 'GET', url: '/v1/federation/nodes', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    const r3 = await rl({ method: 'GET', url: '/v1/federation/nodes', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    check('api: federation routes rate limited (429 after cap)', r1.status === 200 && r2.status === 200 && r3.status === 429, `${r1.status}/${r2.status}/${r3.status}`);
    check('api: phase12 route registry complete', PHASE12_ROUTES.length === 3 && PHASE12_ROUTES.includes('/v1/benchmarks/run'), PHASE12_ROUTES.join(','));

    const expressRouter: any = createRouter({ token: 'x' });
    const mounted = (expressRouter.stack ?? []).map((l: any) => l.route?.path).filter((p: unknown): p is string => typeof p === 'string');
    check('api: express router mounts all three phase-12 routes', PHASE12_ROUTES.every((p) => mounted.includes(p)), mounted.join(','));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 12 SMOKE ===');
  await federationSuite();
  await consensusSuite();
  await benchmarkSuite();
  await apiSuite();
  console.log(`\n=== PHASE 12 SMOKE SUMMARY: ${passes}/${passes + failures} checks passed ===`);
  if (failures > 0) process.exit(1);
}

await main();
