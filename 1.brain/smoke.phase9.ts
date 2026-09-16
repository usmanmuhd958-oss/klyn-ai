// =============================================================================
// KLYN AI OS — Phase 9 Smoke Test
// File: 1.brain/smoke.phase9.ts
//
// Run:  bun run smoke:phase9   (or: bun run 1.brain/smoke.phase9.ts)
//
// Covers all three Phase 9 capabilities:
//   1. Closed-loop autonomous epoch drive — the FULL chain
//      (finding → swarm consensus → transactional patcher → quality gate →
//       post-quantum + Merkle signed commit → learner ingest → policy update)
//   2. Durable persistence layer — JSON-L append-only ledger with cold-boot
//      replay restoration (quantum roots, learner aggregates, policy
//      versions, fleet snapshots) surviving process restarts
//   3. Public authenticated headless API surface — /v1/graph/query,
//      /v1/system/metrics, /v1/audit/verify, /v1/autonomous/heal with strict
//      token auth + rate limiting (framework-free handler + Express mount)
// =============================================================================
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EventBus } from '../packages/core-runtime/src/EventBus.js';
import { PatchPlanner } from './patch_planner.js';
import { TransactionalPatcher } from '../2.body/transactional_patcher.js';
import { QualityGate } from '../packages/self-healing-runtime/src/mutation_harness.js';
import { AgentSwarm } from './swarm/AgentSwarm.js';
import { QuantumZkLedger } from '../kernel/src/security/quantum_zk.js';
import MerkleAudit from '../kernel/src/security/merkle_audit.js';
import { ExperienceLearner } from './experience_learner.js';
import { AdaptivePolicyEngine } from './adaptive_policy.js';
import { JsonlLedger, EnginePersistence } from '../kernel/src/storage/persistent_ledger.js';
import { EpochDriver } from './e2e_autonomous_epoch.js';
import { GraphQueryEngine } from './graph_query_engine.js';
import { RuntimeProfiler } from './runtime_profiler.js';
import { FleetOrchestrator } from '../packages/swarm-mesh/src/fleet_orchestrator.js';
import { createPhase9Handler, createRouter, PHASE9_ROUTES } from '../api/router.js';
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

const SIMPLE_HANDLER = `export function handler(input: string): string {
  return input;
}
`;

function buildEngines(seed: string, ledgerDir: string) {
  const planner = new PatchPlanner();
  const patcher = new TransactionalPatcher();
  return {
    bus: new EventBus(),
    planner,
    patcher,
    swarm: new AgentSwarm(planner, patcher),
    gate: new QualityGate(),
    quantum: new QuantumZkLedger(seed),
    merkle: new MerkleAudit(),
    learner: new ExperienceLearner(),
    policy: new AdaptivePolicyEngine(),
    persistence: new EnginePersistence(new JsonlLedger(ledgerDir)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) CLOSED-LOOP AUTONOMOUS EPOCH DRIVE (E2E)
// ─────────────────────────────────────────────────────────────────────────────
async function epochSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p9-epoch-'));
  try {
    // ── Failure path (own driver): learned, never silently skipped ───────────
    const f = buildEngines('p9-fail-seed', join(dir, 'ledger-fail'));
    const failDriver = new EpochDriver(f);
    const missing = await failDriver.drive({ source: 'fuzzer', route: '/v1/ghost', filePath: join(dir, 'ghost.ts'), detail: 'nope', kind: 'injection', severity: 'high', at: Date.now() }, dir);
    check('epoch: unreadable handler fails cleanly', !missing.ok && missing.errors.some((x) => x.includes('unreadable')) && missing.committed === false, missing.errors.join(';'));
    check('epoch: failure ingested into learner', f.learner.query('patch')?.successRate === 0 && f.learner.query('patch')?.samples === 1, JSON.stringify(f.learner.query('patch')));

    // ── The full closed loop — 8 drives over 8 DISTINCT handler files (each
    //    epoch prepends its own guard; re-preparing the same file would create
    //    duplicate function declarations and rightly fail the swarm compile).
    //    With a 100% success stream the learner crosses the policy proposal
    //    gate (≥ 8 samples) → the adaptive policy RELAXES the gate and
    //    activates a signed v2 at the cadence checkpoint. ────────────────────
    const e = buildEngines('p9-e2e-seed', join(dir, 'ledger'));
    const driver = new EpochDriver({ ...e, proposeEvery: 2 });
    const outcomes = [];
    for (let i = 0; i < 8; i++) {
      const handlerFile = join(dir, `handler-${i}.ts`);
      writeFileSync(handlerFile, SIMPLE_HANDLER);
      outcomes.push(await driver.drive({ source: 'fuzzer', route: `/v1/context:${i}`, filePath: handlerFile, detail: `xss attempt ${i}`, kind: 'xss', severity: 'high', at: Date.now() }, dir));
    }
    const handlerFile = join(dir, 'handler-0.ts');

    const first = outcomes[0];
    check('epoch: full chain committed', first.ok && first.committed && first.gateApproved, first.errors.join(';'));
    check('epoch: four-agent swarm consensus vote', first.votes.length === 4 && ['architect', 'modder', 'auditor', 'tester'].every((r) => first.votes.some((v) => v.role === r)), first.votes.map((v) => `${v.role}:${v.approved}`).join(','));
    check('epoch: file written to disk', first.filesWritten.includes(handlerFile) && first.finalContent !== null && first.finalContent.includes('__klynSanitize'));
    check('epoch: post-quantum signed commit', first.quantumSeq !== null && first.quantumSeq > 0 && typeof first.quantumRoot === 'string' && first.quantumRoot.length === 64, `seq=${first.quantumSeq}`);
    check('epoch: merkle audit chained', typeof first.merkleRoot === 'string' && first.merkleRoot.length === 64);
    check('epoch: learner ingested outcome', first.learnerStats !== null && first.learnerStats.samples >= 1, JSON.stringify(first.learnerStats));

    const last = outcomes[outcomes.length - 1];
    // Policy genesis is v0; a successful activation promotes to v1+.
    check('epoch: policy activated a signed version on evidence', last.policyActivated && last.policyVersion > 0, `version=${last.policyVersion}, activated=${last.policyActivated}`);
    check('epoch: policy ledger tamper-evident', e.policy.verifyLedger());

    const stats = driver.getStats();
    check('epoch: driver counts the closed loop', stats.patchesDriven === 8 && stats.patchSuccessRate !== null && stats.patchSuccessRate > 0, JSON.stringify(stats));

    // ── The durable ledger captured the whole chain — cold-boot restore must
    //    reproduce identical cryptographic state (same seed, same meta, same
    //    order → same roots, byte-exact). ────────────────────────────────────
    const qz2 = new QuantumZkLedger('p9-e2e-seed');
    const restoredQuantum = await e.persistence.restoreQuantum(qz2);
    check('persist: quantum replay restores identical roots', restoredQuantum === e.quantum.recordCount && qz2.root === e.quantum.root && qz2.verify().valid, `restored=${restoredQuantum}, roots-match=${qz2.root === e.quantum.root}`);

    const learner2 = new ExperienceLearner();
    const restoredExp = await e.persistence.restoreLearner(learner2);
    const a = e.learner.query('patch');
    const b = learner2.query('patch');
    check('persist: learner aggregates reproduce', restoredExp > 0 && a !== null && b !== null && a.samples === b.samples && a.successRate === b.successRate, `samples=${b?.samples}, rate=${b?.successRate}`);

    const policy2 = new AdaptivePolicyEngine();
    const restoredPolicy = await e.persistence.restorePolicy(policy2);
    check('persist: policy version + signed ledger replay', restoredPolicy > 0 && policy2.activeVersion === e.policy.activeVersion && policy2.verifyLedger(), `version=${policy2.activeVersion}, events=${restoredPolicy}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) DURABLE PERSISTENCE LAYER (cold-boot restoration)
// ─────────────────────────────────────────────────────────────────────────────
async function persistenceSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p9-ledger-'));
  try {
    const ledger = new JsonlLedger(dir);
    const persistence = new EnginePersistence(ledger);

    // Append-only JSON-L: ordered, per-stream, torn-tail safe.
    await ledger.append('quantum', { type: 'mutation', kind: 'patch', ref: 'a.ts', input: 'in1', output: 'out1', meta: {} });
    await ledger.append('quantum', { type: 'mutation', kind: 'patch', ref: 'b.ts', input: 'in2', output: 'out2', meta: {} });
    check('persist: jsonl append + read round-trip', (await ledger.readAll('quantum')).length === 2 && (await ledger.size('quantum')) === 2);
    check('persist: readLast newest-first slice', (await ledger.readLast('quantum', 1)).length === 1);

    // Torn final line (crash mid-append) is skipped, prefix preserved.
    appendFileSync(join(dir, 'quantum.jsonl'), '{"type": "mutation", "kind": "patch", "ref": "c.ts", "input": "in3", "output": "ou');
    check('persist: torn tail skipped on replay', (await ledger.readAll('quantum')).length === 2);

    // Quantum ledger determinism across restore (clean stream — the scratch
    // records above are dropped so replay sees exactly the two real ones).
    await ledger.reset('quantum');
    const qz = new QuantumZkLedger('p9-persist-seed');
    qz.commitMutation('patch', 'a.ts', 'in1', 'out1', { agent: 'architect' });
    qz.commitMutation('state', 'db:cfg', '{}', '{"sla":200}', { agent: 'evolution' });
    await persistence.persistQuantumMutation(qz, 'patch', 'a.ts', 'in1', 'out1', { agent: 'architect' });
    await persistence.persistQuantumMutation(qz, 'state', 'db:cfg', '{}', '{"sla":200}', { agent: 'evolution' });
    const qz2 = new QuantumZkLedger('p9-persist-seed');
    const n = await persistence.restoreQuantum(qz2);
    check('persist: quantum cold-boot reproduces roots byte-exact', n === 2 && qz2.root === qz.root && qz2.verify().valid, qz2.root === qz.root ? 'roots match' : 'ROOT MISMATCH');

    // Learner: mixed outcomes restore to identical aggregates.
    const l1 = new ExperienceLearner();
    for (let i = 0; i < 6; i++) {
      const ok = i % 3 !== 0;
      l1.record('patch', `op-${i}`, ok, 5 + i, ok ? 'healed' : 'failed');
      await persistence.persistLearnerRecord(l1, 'patch', `op-${i}`, ok, 5 + i, ok ? 'healed' : 'failed');
    }
    const l2 = new ExperienceLearner();
    const re = await persistence.restoreLearner(l2);
    const s1 = l1.query('patch');
    const s2 = l2.query('patch');
    check('persist: learner cold-boot identical aggregates', re === 6 && s1 !== null && s2 !== null && s1.successRate === s2.successRate && s1.samples === s2.samples && s1.avgLatencyMs === s2.avgLatencyMs, `rate=${s2?.successRate}, avg=${s2?.avgLatencyMs}`);

    // Policy: ordered event replay restores version + Merkle ledger.
    const p1 = new AdaptivePolicyEngine();
    p1.observe(true, 10);
    p1.observe(true, 12);
    p1.observe(false, 500);
    await persistence.persistPolicyEvent(p1, { type: 'observe', success: true, latencyMs: 10 });
    await persistence.persistPolicyEvent(p1, { type: 'observe', success: true, latencyMs: 12 });
    await persistence.persistPolicyEvent(p1, { type: 'observe', success: false, latencyMs: 500 });
    const p2 = new AdaptivePolicyEngine();
    const rp = await persistence.restorePolicy(p2);
    check('persist: policy cold-boot restores version + ledger', rp === 3 && p2.activeVersion === p1.activeVersion && p2.verifyLedger(), `version=${p2.activeVersion}`);

    // Fleet: snapshot-based restoration (liveness restored fresh, flags carried).
    const fleet = new FleetOrchestrator({ maxNodes: 8 });
    fleet.registerNode('worker-1');
    fleet.registerNode('worker-2');
    fleet.heartbeat('worker-1', 3);
    fleet.heartbeat('worker-2', 9);
    fleet.reportError('worker-2', 'overload');
    fleet.reportError('worker-2', 'overload');
    check('persist: fleet quarantines overloaded worker', fleet.quarantinedNodes().includes('worker-2'));
    await persistence.persistFleet(fleet);
    const fleet2 = new FleetOrchestrator({ maxNodes: 8 });
    const rf = await persistence.restoreFleet(fleet2);
    check('persist: fleet snapshot restores node table', rf === 2 && fleet2.stats().nodes === 2 && fleet2.quarantinedNodes().includes('worker-2'), `nodes=${fleet2.stats().nodes}`);

    // Stats + reset.
    const stats = await ledger.getStats();
    check('persist: ledger stats reflect streams', stats.streams.includes('quantum') && stats.streams.includes('experience') && stats.streams.includes('policy') && stats.streams.includes('fleet'));
    await ledger.reset('quantum');
    check('persist: stream reset drops entries', (await ledger.size('quantum')) === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) PUBLIC AUTHENTICATED HEADLESS API SURFACE
// ─────────────────────────────────────────────────────────────────────────────
async function apiSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p9-api-'));
  try {
    const handlerFile = join(dir, 'handler.ts');
    const handlerFile2 = join(dir, 'handler2.ts');
    writeFileSync(handlerFile, SIMPLE_HANDLER);
    writeFileSync(handlerFile2, SIMPLE_HANDLER);

    const graph = new GraphQueryEngine();
    graph.addFile('src/api.ts', ['apiHandler']);
    graph.addFile('src/lib.ts', ['libFn']);
    graph.addImport('src/api.ts', 'src/lib.ts');

    const profiler = new RuntimeProfiler({ latencySlaMs: 100, windowMs: 120_000 });
    profiler.record({ route: '/v1/context', latencyMs: 250, memoryDeltaMb: 0, slowQueries: 0, nPlusOne: false, filePath: handlerFile });

    const quantum = new QuantumZkLedger('p9-api-seed');
    quantum.commitMutation('patch', 'pre', 'in', 'out');
    quantum.commitMutation('state', 'cfg', '{}', '{"a":1}');

    const persistence = new EnginePersistence(new JsonlLedger(join(dir, 'ledger')));
    const epoch = new EpochDriver({
      swarm: new AgentSwarm(new PatchPlanner(), new TransactionalPatcher()),
      gate: new QualityGate(),
      quantum,
      merkle: new MerkleAudit(),
      learner: new ExperienceLearner(),
      policy: new AdaptivePolicyEngine(),
      persistence,
    });

    const handler = createPhase9Handler({ graph, profiler, quantum, epoch, repoRoot: dir, token: 'p9-test-token' });
    const call = (req: HeadlessRequest) => handler(req);

    // ── Authorization: closed by default, strict token required ─────────────
    const unauth = await call({ method: 'POST', url: '/v1/graph/query', headers: {}, body: { query: { kind: 'dependencies', target: 'src/api.ts' } } });
    check('api: unauthenticated request rejected 401', unauth.status === 401, String(unauth.status));
    const badToken = await call({ method: 'POST', url: '/v1/graph/query', headers: { authorization: 'Bearer wrong-token' }, body: { query: { kind: 'dependencies', target: 'src/api.ts' } } });
    check('api: wrong token rejected 401', badToken.status === 401, String(badToken.status));
    const noTokenEnv = process.env.KLYN_ADMIN_TOKEN;
    delete process.env.KLYN_ADMIN_TOKEN;
    const closed = await createPhase9Handler({ graph })({ method: 'GET', url: '/v1/system/metrics', headers: {} });
    if (noTokenEnv !== undefined) process.env.KLYN_ADMIN_TOKEN = noTokenEnv;
    check('api: no token configured → surface closed 503', closed.status === 503, String(closed.status));

    const auth = { authorization: 'Bearer p9-test-token' };

    // ── /v1/graph/query ──────────────────────────────────────────────────────
    const gq = await call({ method: 'POST', url: '/v1/graph/query', headers: auth, body: { query: { kind: 'dependencies', target: 'src/api.ts' } } });
    check('api: graph query resolves dependencies', gq.status === 200 && (gq.body as any).success && (gq.body as any).data.ok && (gq.body as any).data.nodes.includes('src/lib.ts'), JSON.stringify((gq.body as any).data?.nodes));
    const badQuery = await call({ method: 'POST', url: '/v1/graph/query', headers: auth, body: {} });
    check('api: malformed graph query rejected 422', badQuery.status === 422, String(badQuery.status));

    // ── /v1/system/metrics ───────────────────────────────────────────────────
    const metrics = await call({ method: 'GET', url: '/v1/system/metrics', headers: auth });
    const mData = (metrics.body as any).data;
    check('api: metrics surface profiler routes + violations', metrics.status === 200 && mData.routes.length === 1 && mData.routes[0].route === '/v1/context' && mData.routes[0].violations.some((v: any) => v.kind === 'latency'), JSON.stringify(mData.routes));

    // ── /v1/audit/verify ─────────────────────────────────────────────────────
    const audit = await call({ method: 'GET', url: '/v1/audit/verify', headers: auth });
    const aData = (audit.body as any).data;
    check('api: audit verdict valid with 2 records', audit.status === 200 && aData.verdict.valid && aData.records === 2, JSON.stringify(aData.verdict));
    const proof = await call({ method: 'GET', url: '/v1/audit/verify?seq=1', headers: auth });
    check('api: audit inclusion proof by seq', proof.status === 200 && (proof.body as any).data.proof !== null, JSON.stringify((proof.body as any).data?.proof?.path?.length ?? 'none'));
    const missingProof = await call({ method: 'GET', url: '/v1/audit/verify?seq=99', headers: auth });
    check('api: unknown seq rejected 404', missingProof.status === 404, String(missingProof.status));

    // ── /v1/autonomous/heal (profiler-driven) ────────────────────────────────
    const heal = await call({ method: 'POST', url: '/v1/autonomous/heal', headers: auth, body: { source: 'profiler', route: '/v1/context' } });
    const hData = (heal.body as any).data;
    check('api: profiler heal drives full epoch', heal.status === 200 && hData.ok && hData.committed && hData.quantumSeq === 3, JSON.stringify(hData?.errors ?? hData?.quantumSeq));
    const auditAfter = await call({ method: 'GET', url: '/v1/audit/verify', headers: auth });
    check('api: epoch commit appended to audit ledger', (auditAfter.body as any).data.records === 3);

    // ── /v1/autonomous/heal (manual/fuzzer finding) ──────────────────────────
    const heal2 = await call({
      method: 'POST',
      url: '/v1/autonomous/heal',
      headers: auth,
      body: { source: 'fuzzer', route: '/v1/fuzz', filePath: handlerFile2, kind: 'xss', severity: 'high', detail: 'manual trigger' },
    });
    const h2Data = (heal2.body as any).data;
    check('api: fuzzer heal commits defensive patch', heal2.status === 200 && h2Data.ok && h2Data.committed && h2Data.finalContent.includes('__klynSanitize'), JSON.stringify(h2Data?.errors ?? ''));

    // ── Rate limiting: bounded per-IP fixed window ───────────────────────────
    const rl = createPhase9Handler({ graph, token: 'rl-token', rateLimit: { max: 2 } });
    const r1 = await rl({ method: 'GET', url: '/v1/system/metrics', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.1' } });
    const r2 = await rl({ method: 'GET', url: '/v1/system/metrics', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.1' } });
    const r3 = await rl({ method: 'GET', url: '/v1/system/metrics', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.1' } });
    check('api: rate limit enforced (429 after cap)', r1.status === 200 && r2.status === 200 && r3.status === 429, `${r1.status}/${r2.status}/${r3.status}`);

    // ── Unknown route + route registry ───────────────────────────────────────
    const unknown = await call({ method: 'POST', url: '/v1/nope', headers: auth, body: {} });
    check('api: unknown route 404', unknown.status === 404, String(unknown.status));
    check('api: phase9 route registry complete', PHASE9_ROUTES.length === 4 && PHASE9_ROUTES.includes('/v1/autonomous/heal'));

    // ── Express router mounts the same four routes ───────────────────────────
    const expressRouter: any = createRouter({ token: 'x' });
    const mounted = (expressRouter.stack ?? []).map((l: any) => l.route?.path).filter((p: unknown): p is string => typeof p === 'string');
    check('api: express router mounts all four phase9 routes', ['/v1/graph/query', '/v1/system/metrics', '/v1/audit/verify', '/v1/autonomous/heal'].every((p) => mounted.includes(p)), mounted.join(','));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 9 SMOKE ===');
  await epochSuite();
  await persistenceSuite();
  await apiSuite();
  console.log(`\n=== PHASE 9 SMOKE SUMMARY: ${passes}/${passes + failures} checks passed ===`);
  if (failures > 0) process.exit(1);
}

void main();
