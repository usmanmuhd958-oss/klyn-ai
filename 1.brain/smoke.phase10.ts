// =============================================================================
// KLYN AI OS — Phase 10 Smoke Test
// File: 1.brain/smoke.phase10.ts
//
// Run:  bun run smoke:phase10   (or: bun run 1.brain/smoke.phase10.ts)
//
// Covers all Phase 10 capabilities — SELF-HOSTING KERNEL EVOLUTION:
//   1. Self-Audit Scanner — deterministic static analysis of Klyn's own
//      source (todo debt, debug logs, sync I/O, eval, any, overlong fns)
//   2. Self-Hosting Guards — critical-file protection, convergence locks,
//      blast-radius containment (Phase 8 graph), manual-finding escalation
//   3. Guarded Self-Epoch — the full Phase 9 closed loop driven against the
//      OS's own source, with tamper-evident manifest, byte-exact rollback,
//      and cold-boot replay
//   4. Public /v1/self/* API — audit / evolve / manifest / rollback behind
//      token auth + rate limiting (headless handler + Express mount)
// =============================================================================
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
import { SelfManifest } from '../kernel/src/storage/self_manifest.js';
import { SelfHostingLoop } from './self_hosting_loop.js';
import { SelfAuditScanner, type SelfAuditFinding } from './self_audit.js';
import { GraphQueryEngine } from './graph_query_engine.js';
import { createPhase9Handler, createRouter, PHASE10_ROUTES } from '../api/router.js';
import type { HeadlessRequest } from '../api/router.js';
import { check, summary } from './smoke/harness.js';

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

function finding(relFile: string, kind: SelfAuditFinding['kind'], line = 1, severity: SelfAuditFinding['severity'] = 'medium'): SelfAuditFinding {
  return {
    id: `${relFile}:${kind}:${line}`,
    file: join(process.env.TEST_ROOT!, relFile),
    relFile,
    line,
    kind,
    severity,
    detail: `fixture ${kind} at ${relFile}:${line}`,
    autoFixable: kind === 'todo_debt' || kind === 'debug_log',
    at: Date.now(),
  };
}

const HANDLER_WITH_LOG = `export function handler(input: string): string {
  console.log('debug trace');
  return input;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// 1) SELF-AUDIT SCANNER
// ─────────────────────────────────────────────────────────────────────────────
async function auditSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p10-audit-'));
  process.env.TEST_ROOT = dir;
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'handler.ts'), `// TODO: replace with real implementation
import { readFileSync } from 'node:fs';

export function handler(input: string): string {
  const data = readFileSync('/etc/hosts');
  console.log('debug trace');
  const x: any = input;
  eval('1 + 1');
  return input;
}
`);
    writeFileSync(join(dir, 'src', 'debt.ts'), `// TODO: wire real auth later
export function auth(): boolean {
  return true;
}
`);
    writeFileSync(
      join(dir, 'src', 'long.ts'),
      `export function big(): string {\n${Array.from({ length: 70 }, (_, i) => `  const v${i} = ${i};`).join('\n')}\n  return 'x';\n}\n`
    );
    writeFileSync(join(dir, 'src', 'clean.ts'), `export function clean(): string {\n  return 'ok';\n}\n`);

    const report = await new SelfAuditScanner().scan(dir);
    check('audit: six detectors across the fixture tree', report.total === 7, `total=${report.total}`);
    check('audit: per-kind counts exact', report.byKind.todo_debt === 2 && report.byKind.debug_log === 1 && report.byKind.sync_blocking_io === 1 && report.byKind.unsafe_eval === 1 && report.byKind.any_typed === 1 && report.byKind.overlong_function === 1, JSON.stringify(report.byKind));
    check('audit: auto-fixable subset identified', report.autoFixable === 3, `autoFixable=${report.autoFixable}`);
    check('audit: clean file produces no findings', !report.findings.some((f) => f.relFile === 'src/clean.ts'));
    check('audit: high-severity findings ranked first', report.findings[0].severity === 'high', `${report.findings[0].kind}@${report.findings[0].severity}`);
    check('audit: overlong function flagged', report.findings.some((f) => f.kind === 'overlong_function' && f.relFile === 'src/long.ts'));
    check('audit: scanned all four source files', report.scannedFiles === 4, `scanned=${report.scannedFiles}`);
  } finally {
    delete process.env.TEST_ROOT;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) SELF-HOSTING GUARDS
// ─────────────────────────────────────────────────────────────────────────────
async function guardsSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p10-guards-'));
  process.env.TEST_ROOT = dir;
  try {
    const e = buildEngines('p10-guard-seed', join(dir, 'ledger'));

    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, '1.brain'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.ts'), HANDLER_WITH_LOG);
    writeFileSync(join(dir, '1.brain', 'e2e_autonomous_epoch.ts'), HANDLER_WITH_LOG);
    writeFileSync(join(dir, 'src', 'unsafe.ts'), `export function run(): string {\n  eval('1 + 1');\n  return 'x';\n}\n`);
    writeFileSync(join(dir, 'src', 'lib1.ts'), HANDLER_WITH_LOG);

    const loop = new SelfHostingLoop({ ...e, repoRoot: dir });

    // ── Critical-path protection ─────────────────────────────────────────────
    const criticalFinding = finding('1.brain/e2e_autonomous_epoch.ts', 'debug_log', 2);
    const veto = await loop.evolve(criticalFinding);
    check('guard: critical file vetoed without force', veto.vetoed && veto.vetoReason === 'CRITICAL_FILE_PROTECTED', String(veto.vetoReason));
    const forced = await loop.evolve(criticalFinding, { force: true });
    check('guard: force bypasses critical protection', !forced.vetoed && forced.epoch !== null && forced.epoch.committed === true, forced.vetoReason ?? String(forced.epoch?.ok));

    // ── Convergence lock (per-file mutation budget) ──────────────────────────
    const report = await loop.audit();
    const appFinding = report.findings.find((f) => f.relFile === 'src/app.ts' && f.kind === 'debug_log')!;
    const first = await loop.evolve(appFinding);
    const second = await loop.evolve(appFinding);
    check('guard: first self-epoch commits', first.ok && first.epoch!.committed, first.epoch?.errors.join(';') ?? '');
    check('guard: convergence lock blocks repeat mutation', second.vetoed && second.vetoReason === 'CONVERGENCE_LOCK', String(second.vetoReason));
    const status1 = await loop.status();
    check('guard: veto counters recorded', (status1.vetoCounts['CONVERGENCE_LOCK'] ?? 0) >= 1, JSON.stringify(status1.vetoCounts));

    // ── Blast-radius containment (Phase 8 graph) ─────────────────────────────
    //    hub.ts ← lib1..lib5 (hub is a 75%-of-graph hotspot → veto);
    //    leaf.ts imports nothing and is imported by no one (→ safe to evolve).
    const graph = new GraphQueryEngine();
    for (const f of ['src/main.ts', 'src/lib1.ts', 'src/lib2.ts', 'src/lib3.ts', 'src/lib4.ts', 'src/lib5.ts', 'src/leaf.ts', 'core/hub.ts']) graph.addFile(f, ['fn']);
    for (const f of ['src/lib1.ts', 'src/lib2.ts', 'src/lib3.ts', 'src/lib4.ts', 'src/lib5.ts']) graph.addImport(f, 'core/hub.ts');
    writeFileSync(join(dir, 'src', 'leaf.ts'), HANDLER_WITH_LOG);
    const loopG = new SelfHostingLoop({ ...e, repoRoot: dir, graph });
    const hubFinding = finding('core/hub.ts', 'debug_log', 1);
    const hub = await loopG.evolve(hubFinding);
    check('guard: high blast radius vetoed', hub.vetoed && hub.vetoReason === 'BLAST_RADIUS_EXCEEDED' && hub.blastRadius !== null && hub.blastRadius >= 5, `radius=${hub.blastRadius}`);
    const leafFinding = finding('src/leaf.ts', 'debug_log', 2);
    const leaf = await loopG.evolve(leafFinding);
    check('guard: low blast radius proceeds to epoch', !leaf.vetoed && leaf.epoch !== null && leaf.epoch.committed === true, leaf.vetoReason ?? String(leaf.epoch?.ok));

    // ── Manual-finding escalation (never auto-mutated) ───────────────────────
    const unsafeFinding = finding('src/unsafe.ts', 'unsafe_eval', 2, 'high');
    const manual = await loop.evolve(unsafeFinding);
    check('guard: manual finding vetoed by default', manual.vetoed && manual.vetoReason === 'MANUAL_FINDING', String(manual.vetoReason));
    const manualForce = await loop.evolve(unsafeFinding, { force: true });
    check('guard: force attempts manual finding but epoch refuses no-op', !manualForce.vetoed && !manualForce.ok && manualForce.manifest.outcome === 'rejected', manualForce.epoch?.errors.join(';') ?? '');
  } finally {
    delete process.env.TEST_ROOT;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) GUARDED SELF-EPOCH (closed loop against Klyn's own source) + MANIFEST
// ─────────────────────────────────────────────────────────────────────────────
async function selfEpochSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p10-epoch-'));
  process.env.TEST_ROOT = dir;
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    const handlerFile = join(dir, 'src', 'handler.ts');
    const original = HANDLER_WITH_LOG;
    writeFileSync(handlerFile, original);

    const e = buildEngines('p10-e2e-seed', join(dir, 'ledger'));
    const manifest = new SelfManifest(new JsonlLedger(join(dir, 'ledger')));
    const loop = new SelfHostingLoop({ ...e, manifest, repoRoot: dir });

    const report = await loop.audit();
    const logFinding = report.findings.find((f) => f.relFile === 'src/handler.ts' && f.kind === 'debug_log')!;
    const outcome = await loop.evolve(logFinding);

    check('epoch: self-mutation committed through full chain', outcome.ok && outcome.epoch !== null && outcome.epoch.committed && outcome.epoch.gateApproved, outcome.epoch?.errors.join(';') ?? '');
    check('epoch: post-quantum signed self-commit', outcome.epoch!.quantumSeq !== null && outcome.epoch!.quantumSeq > 0, `seq=${outcome.epoch!.quantumSeq}`);
    check('epoch: merkle audit chained', typeof outcome.epoch!.merkleRoot === 'string' && outcome.epoch!.merkleRoot.length === 64);
    check('epoch: manifest entry committed with snapshot', outcome.manifest.seq === 1 && outcome.manifest.outcome === 'committed' && outcome.manifest.backupPath !== null && outcome.manifest.hash.length === 64, `seq=${outcome.manifest.seq}`);
    const after = readFileSync(handlerFile, 'utf-8');
    check('epoch: console log neutralized on disk', after.includes('// [klyn-self]') && !/\n\s*console\.log\(/.test(after), JSON.stringify(after.split('\n')[1]));
    check('epoch: backup snapshot persisted', readFileSync(outcome.manifest.backupPath!, 'utf-8') === original);
    check('epoch: manifest chain verifies', (await manifest.verify()).valid === true);

    // ── Deterministic rollback (byte-exact) ──────────────────────────────────
    const rb = await loop.rollback(1);
    check('rollback: file restored byte-exact', rb.ok && readFileSync(handlerFile, 'utf-8') === original, rb.reason ?? '');
    check('rollback: manifest records the undo', rb.manifest !== undefined && rb.manifest.outcome === 'rolled_back' && rb.manifest.seq === 2, `seq=${rb.manifest?.seq}`);

    // ── Cold-boot replay (durable manifest survives a fresh process view) ────
    const bootManifest = new SelfManifest(new JsonlLedger(join(dir, 'ledger')));
    const bootEntries = await bootManifest.all();
    check('persist: cold-boot replay reproduces identical chain', bootEntries.length === 2 && bootEntries[0].hash === outcome.manifest.hash && bootEntries[1].hash === rb.manifest!.hash && (await bootManifest.verify()).valid === true, `entries=${bootEntries.length}`);

    // ── Tamper-evidence: rewriting history breaks the chain ──────────────────
    const ledgerFile = join(dir, 'ledger', 'selfhost.jsonl');
    const text = readFileSync(ledgerFile, 'utf-8');
    const corrupted = text.replace('"seq":1', '"seq":9');
    writeFileSync(ledgerFile, corrupted);
    const verdict = await manifest.verify();
    check('persist: tampered ledger fails verification', verdict.valid === false && verdict.brokenAt !== null, `brokenAt=${verdict.brokenAt}`);
  } finally {
    delete process.env.TEST_ROOT;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) PUBLIC AUTHENTICATED SELF-HOSTING API
// ─────────────────────────────────────────────────────────────────────────────
async function apiSuite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p10-api-'));
  process.env.TEST_ROOT = dir;
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    const handlerFile = join(dir, 'src', 'handler.ts');
    const original = HANDLER_WITH_LOG;
    writeFileSync(handlerFile, original);

    const e = buildEngines('p10-api-seed', join(dir, 'ledger'));
    const manifest = new SelfManifest(new JsonlLedger(join(dir, 'ledger')));
    const loop = new SelfHostingLoop({ ...e, manifest, repoRoot: dir });

    const handler = createPhase9Handler({ selfHosting: loop, repoRoot: dir, token: 'p10-test-token' });
    const call = (req: HeadlessRequest) => handler(req);

    // ── Authorization ─────────────────────────────────────────────────────────
    const unauth = await call({ method: 'POST', url: '/v1/self/audit', headers: {} });
    check('api: unauthenticated self route rejected 401', unauth.status === 401, String(unauth.status));
    const badToken = await call({ method: 'POST', url: '/v1/self/audit', headers: { authorization: 'Bearer wrong-token' } });
    check('api: wrong token rejected 401', badToken.status === 401, String(badToken.status));

    const auth = { authorization: 'Bearer p10-test-token' };

    // ── /v1/self/audit ───────────────────────────────────────────────────────
    const audit = await call({ method: 'POST', url: '/v1/self/audit', headers: auth });
    const aData = (audit.body as any).data;
    const logFinding = aData?.findings?.find((f: any) => f.relFile === 'src/handler.ts' && f.kind === 'debug_log');
    check('api: self audit scans the OS tree', audit.status === 200 && aData.total >= 1 && logFinding !== undefined, `total=${aData?.total}`);

    // ── /v1/self/evolve ──────────────────────────────────────────────────────
    const evolve = await call({ method: 'POST', url: '/v1/self/evolve', headers: auth, body: { findingId: logFinding.id } });
    const evData = (evolve.body as any).data;
    check('api: guarded self-epoch commits via API', evolve.status === 200 && evData.ok && evData.epoch?.committed === true && evData.manifest?.seq === 1, JSON.stringify(evolve.body));
    const missing = await call({ method: 'POST', url: '/v1/self/evolve', headers: auth, body: { findingId: 'ghost' } });
    check('api: unknown finding id rejected 404', missing.status === 404, String(missing.status));

    // ── /v1/self/manifest ────────────────────────────────────────────────────
    const mf = await call({ method: 'GET', url: '/v1/self/manifest', headers: auth });
    const mfData = (mf.body as any).data;
    check('api: manifest route returns chained entries', mf.status === 200 && mfData.entries.length === 1 && mfData.verify.valid === true && mfData.status.auditsRun >= 1, `entries=${mfData.entries?.length}`);

    // ── /v1/self/rollback ────────────────────────────────────────────────────
    const rb = await call({ method: 'POST', url: '/v1/self/rollback', headers: auth, body: { seq: 1 } });
    const rbData = (rb.body as any).data;
    check('api: rollback restores source byte-exact', rb.status === 200 && rbData.ok === true && readFileSync(handlerFile, 'utf-8') === original, rbData?.reason ?? '');
    const badSeq = await call({ method: 'POST', url: '/v1/self/rollback', headers: auth, body: { seq: 99 } });
    check('api: unknown rollback seq rejected 404', badSeq.status === 404, String(badSeq.status));

    // ── Rate limiting + registry + Express mount ─────────────────────────────
    const rl = createPhase9Handler({ token: 'rl-token', rateLimit: { max: 2 } });
    const r1 = await rl({ method: 'GET', url: '/v1/self/manifest', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    const r2 = await rl({ method: 'GET', url: '/v1/self/manifest', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    const r3 = await rl({ method: 'GET', url: '/v1/self/manifest', headers: { authorization: 'Bearer rl-token', 'x-forwarded-for': '10.0.0.9' } });
    check('api: self routes rate limited (429 after cap)', r1.status === 200 && r2.status === 200 && r3.status === 429, `${r1.status}/${r2.status}/${r3.status}`);
    check('api: phase10 route registry complete', PHASE10_ROUTES.length === 4 && PHASE10_ROUTES.includes('/v1/self/rollback'), PHASE10_ROUTES.join(','));

    const expressRouter: any = createRouter({ token: 'x' });
    const mounted = (expressRouter.stack ?? []).map((l: any) => l.route?.path).filter((p: unknown): p is string => typeof p === 'string');
    check('api: express router mounts all four self routes', ['/v1/self/audit', '/v1/self/evolve', '/v1/self/manifest', '/v1/self/rollback'].every((p) => mounted.includes(p)), mounted.join(','));
  } finally {
    delete process.env.TEST_ROOT;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 10 SMOKE ===');
  await auditSuite();
  await guardsSuite();
  await selfEpochSuite();
  await apiSuite();
  summary(10);
}

await main();
