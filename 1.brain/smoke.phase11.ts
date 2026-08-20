// =============================================================================
// KLYN AI OS — Phase 11 Smoke Test
// File: 1.brain/smoke.phase11.ts
//
// Run:  bun run smoke:phase11   (or: bun run 1.brain/smoke.phase11.ts)
//
// Covers all Phase 11 capabilities — TEMPORAL CAUSALITY ENGINE &
// AUTONOMOUS SELF-REPLICATION:
//   1. Hybrid Logical Clock — monotonic local stamps, remote absorption,
//      causal happened-before, concurrent-branch detection, total order
//   2. Time-Travel Engine — baseline snapshots, causal mutations, exact
//      state reconstruction at any seq, cold-boot replay from the JSON-L
//      ledger, delta sync + idempotent ingest, causal merge of branches
//   3. Self-Replication — tamper-evident seed generation, tree
//      verification, byte-exact bootstrap (dry-run + applied), seed
//      integrity (root-hash tamper evidence)
//   4. Public /v1/temporal/* + /v1/replicate/* API — token auth + rate
//      limiting (headless handler + Express mount)
// =============================================================================
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JsonlLedger } from '../kernel/src/storage/persistent_ledger.js';
import { HybridLogicalClock, TemporalCausality, type CausalEvent } from './temporal_causality.js';
import { SelfReplicator, computeSeedRootHash, type ReplicationSeed } from './self_replication.js';
import { createPhase9Handler, createRouter, PHASE11_ROUTES } from '../api/router.js';
import type { HeadlessRequest } from '../api/router.js';
import { check, deepEqual, summary } from './smoke/harness.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1) HYBRID LOGICAL CLOCK
// ─────────────────────────────────────────────────────────────────────────────
function clockSuite(): void {
  const clock = new HybridLogicalClock('a', () => 1000);
  const t1 = clock.now(); // (1000, 1)
  const t2 = clock.now(); // (1000, 2)
  const t3 = clock.now(); // (1000, 3)
  check('hlc: local stamps monotonic within the same wall ms', t2.counter === t1.counter + 1 && t3.counter === t2.counter + 1, `counters ${t1.counter}/${t2.counter}/${t3.counter}`);
  check('hlc: happened-before on sequential local events', HybridLogicalClock.happenedBefore(t1, t2) && HybridLogicalClock.happenedBefore(t2, t3));
  check('hlc: not happened-before backwards', !HybridLogicalClock.happenedBefore(t2, t1));

  const remote = new HybridLogicalClock('b', () => 2000);
  const rb = remote.now(); // (2000, 1)
  const absorbed = clock.recv(rb);
  check('hlc: recv absorbs a remote stamp with a higher wall', absorbed.wall === 2000 && absorbed.counter === 1, `(${absorbed.wall},${absorbed.counter})`);
  check('hlc: absorbed remote ordered after all local history', HybridLogicalClock.happenedBefore(t3, absorbed) && !HybridLogicalClock.happenedBefore(absorbed, t3));
  const t4 = clock.now();
  check('hlc: post-recv local stamp continues the remote counter', t4.wall === 2000 && t4.counter === absorbed.counter + 1, `(${t4.wall},${t4.counter})`);

  const x = new HybridLogicalClock('x', () => 5000);
  const y = new HybridLogicalClock('y', () => 5000);
  const x1 = x.now(); // (5000, 1)
  const y1 = y.now(); // (5000, 1)
  check('hlc: same (wall,counter) on two nodes is CONCURRENT', HybridLogicalClock.concurrent(x1, y1) && !HybridLogicalClock.happenedBefore(x1, y1) && !HybridLogicalClock.happenedBefore(y1, x1));
  check('hlc: total order tie-breaks by nodeId', HybridLogicalClock.compare(x1, y1) === -1 && HybridLogicalClock.compare(y1, x1) === 1);

  const p = new HybridLogicalClock('p', () => 100);
  const q = new HybridLogicalClock('q', () => 100);
  p.now(); // (100, 0) — first stamp jumps the wall, counter resets
  q.now(); // (100, 0)
  const p1 = p.now(); // (100, 1)
  const q1 = q.now(); // (100, 1)
  p.recv(q1); // same wall: counter = max(1, 1) + 1 = 2
  check('hlc: recv merge takes max counter + 1', p.peek().counter === 2, `counter=${p.peek().counter}`);
  check('hlc: an event is never concurrent with itself', !HybridLogicalClock.concurrent(t1, t1));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) TEMPORAL CAUSALITY ENGINE — time travel, cold boot, causal sync
// ─────────────────────────────────────────────────────────────────────────────
async function temporalSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p11-temporal-'));
  try {
    const ledger = new JsonlLedger(join(dir, 'ledger'));
    const a = new TemporalCausality({ nodeId: 'n1', ledger });
    a.snapshot('src/app.ts', 'v0');
    a.mutate('src/app.ts', 'v0', 'v1', { kind: 'epoch' });
    a.mutate('src/app.ts', 'v1', 'v2');
    a.snapshot('src/lib.ts', 'lib0');
    await a.flush();

    const r0 = a.rewind(0);
    check('temporal: rewind(0) is genesis (empty state)', r0.events === 0 && deepEqual(r0.state, {}, false), JSON.stringify(r0.state));
    check('temporal: rewind(1) restores the baseline snapshot', a.rewind(1).state['src/app.ts'] === 'v0');
    check('temporal: rewind(2) restores the first mutation', a.rewind(2).state['src/app.ts'] === 'v1');
    const r4 = a.rewind(4);
    check('temporal: rewind(4) reconstructs the exact full state', r4.state['src/app.ts'] === 'v2' && r4.state['src/lib.ts'] === 'lib0', JSON.stringify(r4.state));

    const stats = a.stats();
    check('temporal: log seq + tracked refs', stats.seq === 4 && deepEqual(stats.trackedRefs, ['src/app.ts', 'src/lib.ts'], false), JSON.stringify(stats.trackedRefs));
    check('temporal: later events happened-before-wise after earlier ones', HybridLogicalClock.happenedBefore(a.hlcOf(1)!, a.hlcOf(4)!) && !HybridLogicalClock.happenedBefore(a.hlcOf(4)!, a.hlcOf(1)!));

    const delta = a.deltaSince(2);
    check('temporal: deltaSince(2) is the minimal catch-up suffix', delta.length === 2 && delta[0].seq === 3 && delta[1].seq === 4, `len=${delta.length}`);

    // ── Cold-boot replay (durable causality survives a fresh process) ──────
    const boot = new TemporalCausality({ nodeId: 'n1', ledger });
    const restored = await boot.restore();
    check('temporal: cold boot restores every causal event', restored === 4 && boot.stats().seq === 4, `restored=${restored}`);
    check('temporal: cold-boot state reconstruction is identical', deepEqual(boot.rewind(4).state, a.rewind(4).state, false));
    check('temporal: cold-boot clock rejoins at-or-after the original HLC', boot.hlc.wall >= a.hlc.wall && boot.hlc.counter >= 0, `boot=(${boot.hlc.wall},${boot.hlc.counter}) orig=(${a.hlc.wall},${a.hlc.counter})`);

    // ── Causal sync: replica catches up via delta ───────────────────────────
    const b = new TemporalCausality({ nodeId: 'n2' });
    const applied = b.applyDelta(delta);
    check('temporal: replica applies the delta', applied === 2 && b.stats().seq === 2, `applied=${applied}`);
    check('temporal: replica state equals the source at the sync point', deepEqual(b.stateSnapshot(), a.rewind(4).state, false));
    check('temporal: re-ingesting the same delta is idempotent', b.applyDelta(delta) === 0);

    // ── Causal merge of diverged branches (CRDT-style) ──────────────────────
    const c = new TemporalCausality({ nodeId: 'c', clock: new HybridLogicalClock('c', () => 3000) });
    c.snapshot('src/branch.ts', 'branch0');
    const merged = TemporalCausality.mergeLogs(a.logSnapshot(), c.logSnapshot());
    const unique = new Set(merged.map((e) => e.id)).size;
    check('temporal: merge unions both branches with dedup', merged.length === 5 && unique === 5, `merged=${merged.length} unique=${unique}`);
    check('temporal: merge preserves the total HLC order', merged.every((e, i) => i === 0 || HybridLogicalClock.compare(merged[i - 1].hlc, e.hlc) <= 0));
    const mergedSelf = TemporalCausality.mergeLogs(a.logSnapshot(), a.logSnapshot());
    check('temporal: merging a log with itself dedupes to the original', mergedSelf.length === 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) AUTONOMOUS SELF-REPLICATION
// ─────────────────────────────────────────────────────────────────────────────
async function replicationSuite(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'klyn-p11-replica-'));
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'klyn-fixture', version: '1.2.3', dependencies: { express: '^5.0.0' }, scripts: { build: 'tsc -p tsconfig.json' } })
    );
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.ts'), 'export const v = 1;\n');
    writeFileSync(join(root, 'src', 'lib', 'util.ts'), 'export function util() { return 42; }\n');

    const r = new SelfReplicator();
    const seed = await r.generateSeed(root);
    check('replicate: seed covers the whole fixture tree', seed.files.length === 3, `files=${seed.files.length}`);
    check('replicate: seed pins version + deps + build', seed.version === '1.2.3' && seed.deps.express === '^5.0.0' && seed.build.build === 'tsc -p tsconfig.json');
    check('replicate: root hash is a sha256', seed.rootHash.length === 64, seed.rootHash.slice(0, 12));
    check('replicate: files are sorted for canonical hashing', seed.files.map((f) => f.path).join('|') === 'package.json|src/app.ts|src/lib/util.ts');

    const clean = await r.verifyTree(seed, root);
    check('replicate: pristine tree verifies byte-exact', clean.valid && clean.matched === 3 && clean.missing.length === 0 && clean.changed.length === 0);

    writeFileSync(join(root, 'src', 'app.ts'), 'export const v = 2;\n');
    const tampered = await r.verifyTree(seed, root);
    check('replicate: tampered file detected as changed', !tampered.valid && tampered.changed.length === 1 && tampered.changed[0].path === 'src/app.ts', JSON.stringify(tampered.changed));

    writeFileSync(join(root, 'src', 'app.ts'), 'export const v = 1;\n');
    rmSync(join(root, 'src', 'lib', 'util.ts'));
    const missing = await r.verifyTree(seed, root);
    check('replicate: deleted file detected as missing', !missing.valid && missing.missing.length === 1 && missing.missing[0] === 'src/lib/util.ts');
    writeFileSync(join(root, 'src', 'lib', 'util.ts'), 'export function util() { return 42; }\n');

    // ── Bootstrap: dry-run then reforge ─────────────────────────────────────
    const dry = await r.bootstrap(root, join(root, 'replica'));
    check('replicate: dry-run bootstraps plan-only (zero writes)', dry.applied === false && dry.files === 3 && dry.verify === null, `applied=${dry.applied}`);

    const applied = await r.bootstrap(root, join(root, 'replica'), { apply: true });
    check('replicate: applied bootstrap writes every seed file', applied.applied === true && applied.files === 3 && applied.verify !== null && applied.verify.valid && applied.verify.matched === 3, JSON.stringify(applied.verify));
    check('replicate: replica bytes match the source exactly', readFileSync(join(root, 'replica', 'src', 'app.ts'), 'utf-8') === readFileSync(join(root, 'src', 'app.ts'), 'utf-8'));

    // ── Seed integrity (tamper evidence on the manifest itself) ─────────────
    check('replicate: seed integrity verifies', r.verifySeedIntegrity(seed) === true);
    const forged: ReplicationSeed = { ...seed, files: [{ path: 'src/app.ts', sha256: '0'.repeat(64), size: 1 }] };
    check('replicate: forged manifest fails the root-hash check', r.verifySeedIntegrity(forged) === false);
    check('replicate: recomputed root hash matches generator output', computeSeedRootHash(seed.engine, seed.version, seed.files) === seed.rootHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) PUBLIC AUTHENTICATED API (/v1/temporal/* + /v1/replicate/*)
// ─────────────────────────────────────────────────────────────────────────────
async function apiSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p11-api-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'klyn-fixture', version: '9.9.9' }));
    mkdirSync(join(dir, 'src'), { recursive: true });
    const appFile = join(dir, 'src', 'app.ts');
    writeFileSync(appFile, 'export const api = 1;\n');

    const temporal = new TemporalCausality({ nodeId: 'api', ledger: new JsonlLedger(join(dir, 'ledger')) });
    temporal.snapshot('src/app.ts', 'export const api = 1;\n');
    temporal.mutate('src/app.ts', 'export const api = 1;\n', 'export const api = 2;\n', { kind: 'epoch' });
    await temporal.flush();

    const replicator = new SelfReplicator();
    const handler = createPhase9Handler({ temporal, replicator, repoRoot: dir, token: 'p11-token' });
    const call = (req: HeadlessRequest) => handler(req);

    // ── Authorization ────────────────────────────────────────────────────────
    const unauth = await call({ method: 'GET', url: '/v1/temporal/now', headers: {} });
    check('api: unauthenticated temporal route rejected 401', unauth.status === 401, String(unauth.status));
    const badToken = await call({ method: 'GET', url: '/v1/temporal/now', headers: { authorization: 'Bearer wrong-token' } });
    check('api: wrong token rejected 401', badToken.status === 401, String(badToken.status));

    const auth = { authorization: 'Bearer p11-token' };

    // ── /v1/temporal/now ─────────────────────────────────────────────────────
    const now = await call({ method: 'GET', url: '/v1/temporal/now', headers: auth });
    const nData = (now.body as any).data;
    check('api: temporal/now reports HLC time + log stats', now.status === 200 && nData.nodeId === 'api' && nData.seq === 2 && nData.persisted === true && nData.hlc.wall > 0, JSON.stringify(nData));

    // ── /v1/temporal/rewind ──────────────────────────────────────────────────
    const rewind = await call({ method: 'GET', url: '/v1/temporal/rewind?seq=1', headers: auth });
    const rwData = (rewind.body as any).data;
    check('api: rewind reconstructs the state at a causal point', rewind.status === 200 && rwData.state['src/app.ts'] === 'export const api = 1;\n', JSON.stringify(rwData.state));
    const badRewind = await call({ method: 'GET', url: '/v1/temporal/rewind?seq=abc', headers: auth });
    check('api: invalid rewind seq rejected 422', badRewind.status === 422, String(badRewind.status));

    // ── /v1/temporal/causality ───────────────────────────────────────────────
    const causality = await call({ method: 'GET', url: '/v1/temporal/causality?a=1&b=2', headers: auth });
    const cData = (causality.body as any).data;
    check('api: causality verdict across two events', causality.status === 200 && cData.happenedBefore === true && cData.concurrent === false, JSON.stringify(cData));
    const ghost = await call({ method: 'GET', url: '/v1/temporal/causality?a=9&b=1', headers: auth });
    check('api: unknown causal seq rejected 404', ghost.status === 404, String(ghost.status));

    // ── /v1/replicate/seed ───────────────────────────────────────────────────
    const seed = await call({ method: 'POST', url: '/v1/replicate/seed', headers: auth });
    const sData = (seed.body as any).data;
    check('api: seed generation + live tree verification', seed.status === 200 && sData.seed.version === '9.9.9' && sData.seed.files.length === 3 && sData.verify.valid === true, `files=${sData.seed?.files?.length}`);
    check('api: seed covers the whole fixture incl. the causal ledger', sData.seed.files.some((f: any) => f.path === 'ledger/causal.jsonl') && sData.seed.files.some((f: any) => f.path === 'package.json'));

    // ── /v1/replicate/sync ───────────────────────────────────────────────────
    const sync = await call({ method: 'GET', url: '/v1/replicate/sync?since=1', headers: auth });
    const sData2 = (sync.body as any).data;
    check('api: sync returns the causal delta since a point', sync.status === 200 && sData2.since === 1 && sData2.to === 2 && sData2.delta.length === 1, `delta=${sData2.delta?.length}`);
    const badSync = await call({ method: 'GET', url: '/v1/replicate/sync?since=abc', headers: auth });
    check('api: invalid sync point rejected 422', badSync.status === 422, String(badSync.status));

    // ── /v1/replicate/bootstrap ──────────────────────────────────────────────
    const bootstrap = await call({ method: 'POST', url: '/v1/replicate/bootstrap', headers: auth, body: { targetDir: join(dir, 'replica'), apply: true } });
    const bData = (bootstrap.body as any).data;
    check('api: bootstrap re-forges a byte-exact verified replica', bootstrap.status === 200 && bData.applied === true && bData.verify.valid === true && bData.files === 3, JSON.stringify(bData.verify));
    const noTarget = await call({ method: 'POST', url: '/v1/replicate/bootstrap', headers: auth, body: {} });
    check('api: bootstrap without targetDir rejected 422', noTarget.status === 422, String(noTarget.status));

    // ── Rate limiting + registry + Express mount ─────────────────────────────
    const rl = createPhase9Handler({ token: 'rl-token', rateLimit: { max: 2 } });
    const r1 = await rl({ method: 'GET', url: '/v1/temporal/now', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    const r2 = await rl({ method: 'GET', url: '/v1/temporal/now', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    const r3 = await rl({ method: 'GET', url: '/v1/temporal/now', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    check('api: phase 11 routes rate limited (429 after cap)', r1.status === 200 && r2.status === 200 && r3.status === 429, `${r1.status}/${r2.status}/${r3.status}`);
    check('api: phase11 route registry complete', PHASE11_ROUTES.length === 6 && PHASE11_ROUTES.includes('/v1/replicate/sync'), PHASE11_ROUTES.join(','));

    const expressRouter: any = createRouter({ token: 'x' });
    const mounted = (expressRouter.stack ?? []).map((l: any) => l.route?.path).filter((p: unknown): p is string => typeof p === 'string');
    check('api: express router mounts all six phase-11 routes', PHASE11_ROUTES.every((p) => mounted.includes(p)), mounted.join(','));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 11 SMOKE ===');
  clockSuite();
  await temporalSuite();
  await replicationSuite();
  await apiSuite();
  summary(11);
}

await main();
