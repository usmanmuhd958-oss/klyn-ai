// =============================================================================
// KLYN AI OS — Phase 4 Smoke Test
// File: 1.brain/smoke.phase4.ts
//
// Run:  bun run smoke:phase4   (or: bun run 1.brain/smoke.phase4.ts)
//
// Covers all four Phase 4 capabilities:
//   1. Real-time predictive profiling & self-optimization loop
//   2. Autonomous intent-to-AST & migration synthesizer
//   3. Cryptographic Merkle audit trail & state rollback
//   4. Zero-latency CRDT event bus & state sync
// =============================================================================
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';

import { RuntimeProfiler } from './runtime_profiler.js';
import { compileIntent, deriveTable, validateIntent } from './spec_compiler.js';
import { MerkleAudit, sha256, hashPair, GENESIS_ROOT } from '../kernel/src/security/merkle_audit.js';
import { LWWRegisterCRDT } from '../packages/workflow-engine/src/crdt_sync.js';
import { EventBus } from '../packages/core-runtime/src/EventBus.js';

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

function fixture(root: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p4-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(dir, rel.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) REAL-TIME PREDICTIVE PROFILING & SELF-OPTIMIZATION LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function profilerSuite(): Promise<void> {
  const bus = new EventBus();
  const events: string[] = [];
  bus.subscribe('profiler:violation', () => events.push('violation'));
  bus.subscribe('profiler:repair:outcome', () => events.push('outcome'));
  bus.subscribe('profiler:repair:skipped', () => events.push('skipped'));

  const handlerFile = `export async function handleContext(_body: unknown): Promise<{ status: number }> {
  return { status: 200 };
}
`;
  const dir = fixture('repo', { 'routes/context.ts': handlerFile });
  const filePath = join(dir, 'routes/context.ts');

  const profiler = new RuntimeProfiler({ bus, latencySlaMs: 200, memorySpikeMb: 64, cooldownMs: 0 });

  // No samples → no violation.
  check('profiler: no samples → no violation', profiler.evaluate('/v1/context').length === 0);

  // Sub-SLA samples → no violation.
  profiler.record({ route: '/v1/context', latencyMs: 5, memoryDeltaMb: 0.1, slowQueries: 0, nPlusOne: false });
  check('profiler: sub-SLA latency → no violation', profiler.evaluate('/v1/context').length === 0);

  // SLA breach: p95 latency > 200ms over the window (first sample carries the
  // handler file path so the repair knows what to patch).
  for (let i = 0; i < 20; i++) {
    profiler.record({
      route: '/v1/context',
      latencyMs: 250 + i,
      memoryDeltaMb: 2,
      slowQueries: 1,
      nPlusOne: i >= 5,
      filePath: i === 0 ? filePath : undefined,
    });
  }
  const violations = profiler.evaluate('/v1/context');
  check('profiler: SLA breach detected (latency + n+1)', violations.some((v) => v.kind === 'latency') && violations.some((v) => v.kind === 'n_plus_one'), violations.map((v) => v.kind).join(','));

  // Dispatch repair → synthesized patch passes QualityGate → applied to disk.
  const outcome = await profiler.dispatchRepair('/v1/context');
  check('profiler: repair dispatched', outcome.dispatched, `applied=${outcome.applied} gate=${outcome.gateApproved}`);
  check('profiler: gate approved + patch applied', outcome.gateApproved && outcome.applied && !outcome.rolledBack);
  check('profiler: file patched with memo cache', readFileSync(filePath, 'utf-8').includes('__klynRouteCache'), `${readFileSync(filePath, 'utf-8').split('\n').length} lines`);
  check('profiler: violation + outcome events published', events.includes('violation') && events.includes('outcome'), events.join(','));

  // Cooldown: a re-dispatch within the cooldown window is skipped.
  const coolProfiler = new RuntimeProfiler({ latencySlaMs: 200, cooldownMs: 60_000 });
  coolProfiler.record({ route: '/r', latencyMs: 900, memoryDeltaMb: 1, slowQueries: 0, nPlusOne: false });
  await coolProfiler.dispatchRepair('/r'); // first dispatch sets the cooldown
  const skipped = await coolProfiler.dispatchRepair('/r'); // inside window → skipped
  check('profiler: cooldown blocks repair storms', skipped.dispatched === false && skipped.error === 'cooldown active');

  // QualityGate rejection path: a synthesizer that emits broken code is never applied.
  const badDir = fixture('repo', { 'route.ts': handlerFile });
  const badPath = join(badDir, 'route.ts');
  const badProfiler = new RuntimeProfiler({
    latencySlaMs: 200,
    cooldownMs: 0,
    patchSynthesizer: () => 'export function broken(: number {',
  });
  badProfiler.record({ route: '/bad', latencyMs: 900, memoryDeltaMb: 0, slowQueries: 0, nPlusOne: false, filePath: badPath });
  const badOutcome = await badProfiler.dispatchRepair('/bad');
  check(
    'profiler: gate rejects broken synthesis — disk untouched',
    !badOutcome.gateApproved && !badOutcome.applied && readFileSync(badPath, 'utf-8') === handlerFile,
    badOutcome.error ?? ''
  );

  // The self-optimization loop tick dispatches repairs for breached routes.
  const loopProfiler = new RuntimeProfiler({ latencySlaMs: 200, cooldownMs: 0 });
  loopProfiler.record({ route: '/loop', latencyMs: 800, memoryDeltaMb: 0, slowQueries: 0, nPlusOne: false });
  const tickOutcomes = await loopProfiler.tick();
  check('profiler: tick() dispatches for breached route', tickOutcomes.some((o) => o.route === '/loop' && o.dispatched));
  loopProfiler.stop();

  rmSync(dir, { recursive: true, force: true });
  rmSync(badDir, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) AUTONOMOUS INTENT-TO-AST & MIGRATION SYNTHESIZER
// ─────────────────────────────────────────────────────────────────────────────
function specCompilerSuite(): void {
  const intent = {
    entity: 'Project',
    fields: [
      { name: 'id', type: 'id' as const, optional: true },
      { name: 'name', type: 'string' as const },
      { name: 'ownerId', type: 'string' as const, indexed: true },
      { name: 'active', type: 'boolean' as const, default: true },
      { name: 'meta', type: 'json' as const, optional: true },
      { name: 'dueDate', type: 'date' as const, optional: true },
    ],
    operations: ['create', 'read', 'list', 'update', 'delete'] as const,
    migrationFlavor: 'supabase' as const,
  };

  const spec = compileIntent(intent);
  check('spec: table derived deterministically', spec.table === 'projects', spec.table);
  check('spec: interface generated + parsed as valid TS AST', spec.astNodeCount > 0 && spec.interfaceCode.includes('export interface Project'), `ast=${spec.astNodeCount}`);
  check('spec: zero hallucinated imports (no import/require lines)', !/^\s*(import|require)\b/m.test(spec.endpointCode) && !/^\s*(import|require)\b/m.test(spec.validationCode));

  // Generated validator behaves correctly against real inputs (export
  // keywords stripped so the declaration is valid in a Function body).
  const moduleSrc = `${spec.interfaceCode}\n${spec.validationCode}`.replace(/^export /gm, '');

  // Static determinism: two compiles of the same intent are byte-identical.
  const again = compileIntent(intent);
  check('spec: compile is deterministic (identical interface/validation/migration)', spec.interfaceCode === again.interfaceCode && spec.validationCode === again.validationCode && spec.migrationCode === again.migrationCode);
  check('spec: deterministic key stable', spec.deterministicKey === again.deterministicKey);

  // Migration content per flavor.
  check('spec: supabase migration has RLS + indexes', spec.migrationCode.includes('ENABLE ROW LEVEL SECURITY') && spec.migrationCode.includes('idx_projects_ownerId'), spec.migrationFile);
  const prismaSpec = compileIntent({ ...intent, migrationFlavor: 'prisma' });
  check('spec: prisma flavor emits model + up/down SQL', prismaSpec.migrationCode.includes('model Project') && prismaSpec.migrationCode.includes('export const up'));
  const drizzleSpec = compileIntent({ ...intent, migrationFlavor: 'drizzle' });
  check('spec: drizzle flavor emits table constant + SQL', drizzleSpec.migrationCode.includes("export const tableName = 'projects'") && drizzleSpec.migrationCode.includes('CREATE TABLE'));

  // Validation behavior — execute the generated validator in-process (TS is
  // transpiled to plain JS first; the emitted code needs no imports).
  const transpiled = ts.transpileModule(moduleSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const projectValidator = new Function(
    `${transpiled}\nreturn validateProject;`
  )() as (input: unknown) => { ok: boolean; errors: string[]; value: unknown };
  const valid = projectValidator({ name: 'Klyn', ownerId: 'user-1', active: true, meta: { a: 1 } });
  check('spec: generated validator accepts a valid body', valid.ok === true && valid.value !== undefined);
  const invalid = projectValidator({ active: 'not-a-bool' });
  check('spec: generated validator rejects wrong types', invalid.ok === false && invalid.errors.some((e) => e.includes('active')), invalid.errors.join(';'));
  const missing = projectValidator({});
  check('spec: generated validator rejects missing required field', missing.ok === false && missing.errors.some((e) => e.includes('name')), missing.errors.join(';'));

  // Endpoint surface.
  check('spec: all 5 CRUD endpoints generated', spec.endpoints.length === 5, spec.endpoints.map((e) => `${e.method} ${e.path}`).join(','));
  check('spec: create endpoint validates then returns 201', spec.endpoints.find((e) => e.handlerName === 'createProject')?.code.includes('status: 201') === true);

  // Invalid intents are rejected, not silently compiled.
  const invalidIntent = validateIntent({ entity: 'bad entity', fields: [] } as never);
  check('spec: invalid intent rejected with errors', invalidIntent.valid === false && invalidIntent.errors.length > 0, invalidIntent.errors.join('; '));

  // Derived table naming.
  check('spec: deriveTable snake_cases + pluralizes', deriveTable('UserAccount') === 'user_accounts' && deriveTable('Data') === 'datas', deriveTable('UserAccount'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) CRYPTOGRAPHIC MERKLE AUDIT TRAIL & STATE ROLLBACK
// ─────────────────────────────────────────────────────────────────────────────
async function merkleSuite(): Promise<void> {
  const fsState = new Map<string, string>();
  const dbState = new Map<string, unknown>();
  const audit = new MerkleAudit({
    appliers: {
      fs: (op) => { if (op.delete) fsState.delete(op.ref); else if (op.content !== null) fsState.set(op.ref, op.content); },
      db: (op) => { if (op.delete) dbState.delete(op.ref); else dbState.set(op.ref, op.value); },
    },
  });

  check('merkle: genesis root on empty ledger', audit.root === GENESIS_ROOT);

  // The appliers only run during ROLLBACK — mirror the audit's writes on a
  // simulated disk so the rollback verification is meaningful.
  audit.commitFile('/repo/a.ts', 'export const a = 1;\n', { agent: 'architect' });
  fsState.set('/repo/a.ts', 'export const a = 1;\n');
  const e2 = audit.commitFile('/repo/b.ts', 'export const b = 2;\n');
  fsState.set('/repo/b.ts', 'export const b = 2;\n');
  audit.commitState('users:1', { role: 'admin' });
  dbState.set('users:1', { role: 'admin' });
  audit.commitFile('/repo/a.ts', 'export const a = 2;\n'); // update
  fsState.set('/repo/a.ts', 'export const a = 2;\n');
  audit.commitEvent('swarm:epoch:committed', { epoch: 1 });

  check('merkle: roots are unique per commit', audit.entryCount === 5 && new Set(audit.entries().map((e) => e.root)).size === 5);
  check('merkle: sequence numbers are strictly monotonic', audit.seqValue === 5 && audit.entries()[0].seq === 1 && audit.entries()[4].seq === 5);

  // Cryptographic verification: recomputed root matches the signed root.
  check('merkle: verify(current root) passes', audit.verify());
  check('merkle: verify(wrong root) fails', !audit.verify(sha256('tampered')));
  check('merkle: chain verifies (prevRoot linkage)', audit.verifyChain());

  // Tamper detection: mutate the journal in memory → the full ledger replay
  // fails (hash/root mismatch), even though the live state still verifies.
  const tampered = audit.entries();
  tampered[1].hash = sha256('tampered content');
  const cloneAudit = new MerkleAudit();
  (cloneAudit as unknown as { journal: unknown[] }).journal = tampered as unknown as unknown[];
  check('merkle: tampered journal fails full-ledger verification', !cloneAudit.verifyLedger());

  // Merkle proof: recompute the path and it must reach the current root.
  const proof = audit.proof('/repo/a.ts');
  check('merkle: proof exists for a committed ref', proof !== null && proof.ref === '/repo/a.ts');
  if (proof) {
    check('merkle: proof path recomputes to the signed root', MerkleAudit.verifyProof(proof), `path=${proof.path.length} steps`);
  }

  // ROLLBACK: restore fs + db to the state at e2 (before a.ts v2 + users:1).
  const rollback = await audit.rollbackToMerkleRoot(e2.root);
  check('merkle: rollback ok + ops returned', rollback.ok === true && rollback.applied > 0, `ops=${rollback.ops.length} applied=${rollback.applied}`);
  check('merkle: fs restored to historical content', fsState.get('/repo/a.ts') === 'export const a = 1;\n', fsState.get('/repo/a.ts') ?? 'MISSING');
  check('merkle: db rolled back (users:1 absent at e2)', dbState.has('users:1') === false);
  check('merkle: untouched refs still present', fsState.get('/repo/b.ts') === 'export const b = 2;\n');

  // Rollback to genesis resets everything.
  const toGenesis = await audit.rollbackToMerkleRoot(GENESIS_ROOT);
  check('merkle: rollback to genesis clears all refs', toGenesis.ok === true && fsState.size === 0 && dbState.size === 0, `fs=${fsState.size} db=${dbState.size}`);

  // Unknown root → clean failure, no partial application.
  const bogus = await audit.rollbackToMerkleRoot(sha256('never committed'));
  check('merkle: unknown root rejected without side effects', bogus.ok === false && bogus.errors.length > 0);

  // Hash primitive sanity.
  check('merkle: hashPair is deterministic + order-independent', hashPair('a', 'b') === hashPair('b', 'a') && sha256('x') === sha256('x'));
  check('merkle: live ref count matches signed refs', audit.liveRefCount === 4, `refs=${audit.liveRefCount}`); // a.ts, b.ts, users:1, event
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) ZERO-LATENCY CRDT EVENT BUS & STATE SYNC
// ─────────────────────────────────────────────────────────────────────────────
function crdtSuite(): void {
  // A) Concurrent mutation without locks: two replicas mutate the same ref in
  //    different orders → both converge to the same LWW winner.
  const bus = new EventBus();
  const agentA = new LWWRegisterCRDT('agent-A', bus);
  const agentB = new LWWRegisterCRDT('agent-B', bus);

  const u1 = agentA.mutate('routes/user.ts', 'export const v = 1;\n');
  const u2 = agentB.mutate('routes/user.ts', 'export const v = 2;\n');
  const u3 = agentA.mutate('routes/user.ts', 'export const v = 3;\n');

  // Simulate remote delivery in a different order than generation: bus echo
  // already applied A→B in order, so force a state-based merge for the test.
  const replicaC = new LWWRegisterCRDT('agent-C');
  replicaC.applyBatch([u3, u1, u2]); // shuffled arrival
  agentA.applyBatch([u2, u3, u1]);
  agentB.merge(agentA);

  check('crdt: LWW total order picks the highest lamport', agentA.get('routes/user.ts') === 'export const v = 3;\n', `value=${agentA.get('routes/user.ts')}`);
  check('crdt: all replicas converge to the same state', agentA.materialize()['routes/user.ts'] === replicaC.materialize()['routes/user.ts'] && agentB.materialize()['routes/user.ts'] === replicaC.materialize()['routes/user.ts']);
  check('crdt: lamport clock advanced past remote ops', agentB.clock > u3.lamport, `clock=${agentB.clock}`);

  // B) EventBus round-trip: a third replica attached to the bus receives the
  //    update as it happens (zero-latency in-process sync).
  const listener = new LWWRegisterCRDT('listener');
  listener.attach(bus);
  agentA.mutate('routes/new.ts', 'export const n = 1;\n');
  check('crdt: bus-attached replica syncs live', listener.get('routes/new.ts') === 'export const n = 1;\n');
  listener.detach();

  // C) Delete (tombstone) wins under LWW when it carries a higher clock.
  agentA.mutate('routes/gone.ts', 'export const g = 1;\n');
  agentB.mutate('routes/gone.ts', null);
  check('crdt: delete tombstone materializes as absent', agentA.get('routes/gone.ts') === null && agentA.materialize()['routes/gone.ts'] === undefined);

  // D) Wire format round-trips for WebSocket / CLI clients.
  const wire = agentA.toWire();
  const restored = LWWRegisterCRDT.fromWire(wire, 'agent-D');
  restored.merge(agentA);
  check('crdt: wire format restores identical state', restored.materialize()['routes/user.ts'] === agentA.materialize()['routes/user.ts'] && restored.materialize()['routes/new.ts'] === agentA.materialize()['routes/new.ts']);

  // E) Disjoint refs from different replicas both survive the merge (no lost updates).
  const r1 = new LWWRegisterCRDT('r1');
  const r2 = new LWWRegisterCRDT('r2');
  r1.mutate('file1.ts', 'a');
  r2.mutate('file2.ts', 'b');
  const mergeResult = r1.merge(r2);
  check('crdt: disjoint refs merge without conflict', mergeResult.conflicts === 0 && r1.get('file2.ts') === 'b' && r1.get('file1.ts') === 'a', `applied=${mergeResult.applied} conflicts=${mergeResult.conflicts}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 4 SMOKE ===');
  await profilerSuite();
  specCompilerSuite();
  await merkleSuite();
  crdtSuite();
  console.log(`\n=== PHASE 4 SMOKE SUMMARY: ${passes}/${passes + failures} checks passed ===`);
  if (failures > 0) process.exit(1);
}

void main();
