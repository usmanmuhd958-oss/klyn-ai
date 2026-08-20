// =============================================================================
// KLYN AI OS — Phase 5 Smoke Test
// File: 1.brain/smoke.phase5.ts
//
// Run:  bun run smoke:phase5   (or: bun run 1.brain/smoke.phase5.ts)
//
// Covers all four Phase 5 capabilities:
//   1. Cross-repository AST symbol & impact propagation engine
//   2. High-performance wasm & worker isolation sandbox (<5ms SLA)
//   3. Dynamic multi-model cascade router & cost optimizer
//   4. Autonomous spec-driven E2E virtualization
// =============================================================================
import { CrossRepoGraph, fingerprint } from './cross_repo_graph.js';
import { SandboxPool, WorkerSandbox, ADD_WASM } from '../packages/self-healing-runtime/src/wasm_sandbox.js';
import { CascadeRouter } from './cascade_router.js';
import { E2EVirtualizer } from '../packages/workflow-engine/src/e2e_virtualizer.js';
import { EventBus } from '../packages/core-runtime/src/EventBus.js';
import { check, summary } from './smoke/harness.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1) CROSS-REPOSITORY AST SYMBOL & IMPACT PROPAGATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function crossRepoSuite(): void {
  const graph = new CrossRepoGraph();

  // api repo exports its contract surface; web + mobile consume it.
  graph.registerRepo('api', [
    { symbol: 'User', kind: 'type', signature: 'User { id: string; name: string; }', fingerprint: fingerprint('User { id: string; name: string; }') },
    { symbol: 'getUser', kind: 'function', signature: 'getUser(id: string): User', fingerprint: fingerprint('getUser(id: string): User') },
    { symbol: '/users', kind: 'endpoint', signature: 'GET /users -> User[]', fingerprint: fingerprint('GET /users -> User[]') },
  ]);
  graph.addImporter('web', 'User');
  graph.addImporter('web', 'getUser');
  graph.addImporter('mobile', 'User');

  // Sub-ms global symbol resolution.
  const resolved = graph.resolveSymbol('User');
  check('crossrepo: global symbol resolves to owning repo', resolved.repo === 'api' && resolved.importers.includes('web') && resolved.importers.includes('mobile'), `repo=${resolved.repo} importers=${resolved.importers.join(',')}`);
  check('crossrepo: resolution is sub-ms', resolved.latencyMs < 1, `${resolved.latencyMs.toFixed(3)}ms`);

  // Unchanged contract → no break.
  const unchanged = graph.detectBreakingChange('api', [
    { symbol: 'User', kind: 'type', oldSignature: 'User { id: string; name: string; }', newSignature: 'User { id: string; name: string; }', oldFingerprint: fingerprint('User { id: string; name: string; }'), newFingerprint: fingerprint('User { id: string; name: string; }') },
  ]);
  check('crossrepo: unchanged contract is NOT breaking', unchanged[0].breaking === false && unchanged[0].affectedRepos.length === 0);

  // Breaking change: User gains a required field → both dependents affected,
  // compensating patches synthesized.
  const newSig = 'User { id: string; name: string; email: string; }';
  const impacts = graph.detectBreakingChange('api', [
    { symbol: 'User', kind: 'type', oldSignature: 'User { id: string; name: string; }', newSignature: newSig, oldFingerprint: fingerprint('User { id: string; name: string; }'), newFingerprint: fingerprint(newSig) },
  ]);
  const impact = impacts[0];
  check('crossrepo: breaking type change detected with both dependents', impact.breaking === true && impact.affectedRepos.join(',') === 'mobile,web', impact.affectedRepos.join(','));
  check(
    'crossrepo: compensating shim synthesized for dependent repo',
    impact.patch !== null && impact.patch.kind === 'type' && impact.patch.content.includes('compat shim'),
    impact.patch?.filePath ?? 'NO PATCH'
  );

  // Function contract break → adapter patch, bus event published.
  const bus = new EventBus();
  const events: string[] = [];
  bus.subscribe('crossrepo:breaking', (e) => events.push(String((e.payload as { symbol: string }).symbol)));
  const fnGraph = new CrossRepoGraph(bus);
  fnGraph.registerRepo('api', [{ symbol: 'getUser', kind: 'function', signature: 'getUser(id: string): User', fingerprint: fingerprint('getUser(id: string): User') }]);
  fnGraph.addImporter('web', 'getUser');
  const fnImpact = fnGraph.detectBreakingChange('api', [
    { symbol: 'getUser', kind: 'function', oldSignature: 'getUser(id: string): User', newSignature: 'getUser(id: string, opts: {}) : User', oldFingerprint: fingerprint('getUser(id: string): User'), newFingerprint: fingerprint('getUser(id: string, opts: {}) : User') },
  ]);
  check('crossrepo: function break synthesizes client adapter', fnImpact[0].breaking && fnImpact[0].patch?.kind === 'function' && fnImpact[0].patch.content.includes('client adapter'));
  check('crossrepo: breaking change published to event bus', events.includes('getUser'), events.join(','));

  check('crossrepo: registry stats correct', graph.getStats().repos === 1 && graph.getStats().symbols === 3 && graph.getStats().importEdges === 3, JSON.stringify(graph.getStats()));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) HIGH-PERFORMANCE WASM & WORKER ISOLATION SANDBOX
// ─────────────────────────────────────────────────────────────────────────────
async function sandboxSuite(): Promise<void> {
  // Benign untrusted script executes with its args.
  const box = new WorkerSandbox();
  const ok = await box.runJs('return __klynArgs[0] + __klynArgs[1];', [20, 22]);
  check('sandbox: untrusted script executes with args', ok.ok && ok.result === 42, String(ok.result));

  // Host I/O vectors are disabled.
  const proc = await box.runJs('process.exit(1)', []);
  check('sandbox: process access rejected', proc.ok === false && String(proc.error).includes('rejected'), proc.error ?? '');
  const req = await box.runJs('require("node:fs").readFileSync("/etc/passwd")', []);
  check('sandbox: require rejected', req.ok === false);
  const dynImport = await box.runJs('import("node:fs").then(m => m.readFileSync("/etc/passwd"))', []);
  check('sandbox: dynamic import rejected', dynImport.ok === false);
  const escape = await box.runJs('this.constructor.constructor("return process")()', []);
  check('sandbox: constructor-escape vector rejected', escape.ok === false, escape.error ?? '');

  // A runaway script is terminated at the hard budget — never left spinning.
  const spinner = new WorkerSandbox({ timeoutMs: 400, cpuTimeMs: 200 });
  const hung = await spinner.runJs('while (true) { /* spin */ }', []);
  check('sandbox: runaway script terminated at budget', hung.ok === false && hung.terminated === true && String(hung.error).includes('timeout'), hung.error ?? '');
  await spinner.terminate();

  // WebAssembly executes with ZERO host imports (empty import object).
  const wasm = await box.runWasm(ADD_WASM, 'add', [7, 8]);
  check('sandbox: wasm module executes in isolation', wasm.ok && wasm.result === 15, String(wasm.result));
  const missing = await box.runWasm(ADD_WASM, 'nonexistent', [1]);
  check('sandbox: missing wasm export reported', missing.ok === false && String(missing.error).includes('not found'));
  await box.terminate();

  // <5ms SLA: the warm primed pool executes at transport speed.
  const pool = new SandboxPool({ concurrency: 2 });
  await pool.warm(2);
  const t0 = performance.now();
  const warm = await pool.runJs('return 40 + 2;', []);
  const latencyMs = performance.now() - t0;
  check('sandbox: warm pool result correct', warm.ok && warm.result === 42);
  check('sandbox: warm instantiation latency < 5ms SLA', latencyMs < 5, `${latencyMs.toFixed(2)}ms`);
  const wasmWarm = await pool.runWasm(ADD_WASM, 'add', [1, 2]);
  check('sandbox: wasm via warm pool', wasmWarm.ok && wasmWarm.result === 3);
  check('sandbox: pool reuse across runs', pool.size === 2, `slots=${pool.size}`);
  await pool.terminate();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) DYNAMIC MULTI-MODEL CASCADE ROUTER & COST OPTIMIZER
// ─────────────────────────────────────────────────────────────────────────────
async function cascadeSuite(): Promise<void> {
  const bus = new EventBus();
  const events: string[] = [];
  bus.subscribe('cascade:decision', () => events.push('decision'));
  bus.subscribe('cascade:cost', () => events.push('cost'));
  bus.subscribe('cascade:escalation', () => events.push('escalation'));

  const router = new CascadeRouter({ bus });
  const models = router.listModels();
  check('cascade: real registry models loaded (fast + reasoning)', models.some((m) => m.tier === 'fast') && models.some((m) => m.tier === 'reasoning'), models.map((m) => `${m.name}:${m.tier}`).join(','));

  // A) Simple sub-task → fast model, no escalation, real savings vs reasoning-only.
  const simpleOutcome = await router.execute(
    { kind: 'ast_parse', complexity: 0.2, estimatedInputTokens: 400, estimatedOutputTokens: 120 },
    async (model) => ({ confidence: 0.99, inputTokens: 400, outputTokens: 120, latencyMs: 120, content: `parsed by ${model}` })
  );
  check('cascade: simple task routes to fast model', simpleOutcome.calls[0].tier === 'fast', simpleOutcome.calls[0].model);
  check('cascade: simple task never escalates', simpleOutcome.escalated === false && simpleOutcome.calls.length === 1);
  check('cascade: fast path saves money vs reasoning-only', simpleOutcome.savingsUsd < 0, `savings=${simpleOutcome.savingsUsd.toFixed(6)}`);

  // B) Complex architectural decision → reasoning by policy.
  const complexOutcome = await router.execute(
    { kind: 'architecture', complexity: 0.9, estimatedInputTokens: 2000, estimatedOutputTokens: 500 },
    async (model) => ({ confidence: 1, inputTokens: 2000, outputTokens: 500, latencyMs: 900, content: `designed by ${model}` })
  );
  check('cascade: complex task starts at reasoning tier', complexOutcome.calls[0].tier === 'reasoning' && complexOutcome.escalated === true, complexOutcome.calls[0].model);

  // C) Confidence below threshold on the fast attempt → cascade to reasoning.
  const shakyOutcome = await router.execute(
    { kind: 'syntax_repair', complexity: 0.4, estimatedInputTokens: 600, estimatedOutputTokens: 300 },
    async (model) => {
      if (model === 'gpt-4o-mini') return { confidence: 0.4, inputTokens: 600, outputTokens: 300, latencyMs: 150, content: 'fast guess' };
      return { confidence: 0.95, inputTokens: 600, outputTokens: 300, latencyMs: 1200, content: 'reasoned fix' };
    }
  );
  check('cascade: low confidence escalates to reasoning', shakyOutcome.escalated === true && shakyOutcome.calls.length === 2, `calls=${shakyOutcome.calls.map((c) => c.model).join(' -> ')}`);
  check('cascade: final answer comes from the reasoning model', String(shakyOutcome.result) === 'reasoned fix' && shakyOutcome.confidence >= 0.85);

  // D) Strict SLA → skips fast even for simple work.
  const slaOutcome = await router.execute(
    { kind: 'ast_parse', complexity: 0.1, slaMs: 100, estimatedInputTokens: 100, estimatedOutputTokens: 50 },
    async (model) => ({ confidence: 1, inputTokens: 100, outputTokens: 50, latencyMs: 60, content: model })
  );
  check('cascade: strict SLA routes past the fast tier', slaOutcome.decision.escalatedByPolicy === true && slaOutcome.calls[0].tier !== 'fast', slaOutcome.decision.reason);

  // E) Telemetry streamed to the EventBus + router stats.
  check('cascade: decision/cost/escalation events published', events.includes('decision') && events.includes('cost') && events.includes('escalation'), events.join(','));
  const stats = router.getStats();
  check('cascade: stats accumulate decisions + savings', stats.decisions >= 4 && stats.totalSavingsUsd < 0, `decisions=${stats.decisions} savings=${stats.totalSavingsUsd.toFixed(6)}`);
  check('cascade: per-model latency tracked', Object.keys(stats.perModel).length >= 2 && Object.values(stats.perModel).every((m) => m.avgLatencyMs > 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) AUTONOMOUS SPEC-DRIVEN E2E VIRTUALIZATION
// ─────────────────────────────────────────────────────────────────────────────
async function e2eSuite(): Promise<void> {
  const intent = {
    entity: 'Project',
    fields: [
      { name: 'id', type: 'id' as const, optional: true },
      { name: 'name', type: 'string' as const },
      { name: 'ownerId', type: 'string' as const },
      { name: 'active', type: 'boolean' as const, default: true },
    ],
    operations: ['create', 'read', 'list', 'update', 'delete'] as const,
    migrationFlavor: 'supabase' as const,
  };
  let seq = 0;
  const v = E2EVirtualizer.fromIntent(intent, () => `p-${++seq}`);

  // Full CRUD workflow, entirely in memory — no ports, no database.
  const created = await v.request({ method: 'POST', path: '/projects', body: { name: 'Klyn OS', ownerId: 'u1' } });
  check('e2e: create returns 201 + persisted row', created.status === 201 && (created.body as { value: Record<string, unknown> }).value.id === 'p-1', JSON.stringify(created.body));
  const created2 = await v.request({ method: 'POST', path: '/projects', body: { name: 'Portal', ownerId: 'u2' } });
  check('e2e: second create', created2.status === 201);

  const listed = await v.request({ method: 'GET', path: '/projects' });
  check('e2e: list returns all rows', listed.status === 200 && (listed.body as { rows: unknown[] }).rows.length === 2, `rows=${(listed.body as { rows: unknown[] }).rows.length}`);

  const read = await v.request({ method: 'GET', path: '/projects/p-1' });
  check('e2e: read by id', read.status === 200 && (read.body as { value: { name: string } }).value.name === 'Klyn OS');

  // PUT validates the FULL body (spec semantics — required fields enforced).
  const updated = await v.request({ method: 'PUT', path: '/projects/p-1', body: { name: 'Klyn OS v2', ownerId: 'u1', active: false } });
  check('e2e: update merges fields', updated.status === 200 && (updated.body as { value: { name: string; active: boolean } }).value.name === 'Klyn OS v2' && (updated.body as { value: { active: boolean } }).value.active === false);

  const deleted = await v.request({ method: 'DELETE', path: '/projects/p-1' });
  check('e2e: delete removes the row', deleted.status === 200 && v.rowCount() === 1, `rows=${v.rowCount()}`);
  const readGone = await v.request({ method: 'GET', path: '/projects/p-1' });
  check('e2e: read after delete → 404', readGone.status === 404);

  // Schema enforcement: wrong types and missing required fields → 400.
  const badType = await v.request({ method: 'POST', path: '/projects', body: { name: 42, ownerId: 'u1' } });
  check('e2e: wrong-type body rejected 400', badType.status === 400 && (badType.body as { errors: string[] }).errors.some((e) => e.includes('name')));
  const missing = await v.request({ method: 'POST', path: '/projects', body: { name: 'X' } });
  check('e2e: missing required field rejected 400', missing.status === 400 && (missing.body as { errors: string[] }).errors.some((e) => e.includes('ownerId')));

  // Unknown route → 404 without crashing.
  const unknown = await v.request({ method: 'GET', path: '/nope' });
  check('e2e: unknown route → 404', unknown.status === 404);

  // Virtual WebSocket: in-process fan-out, no ports.
  const alice = v.openWs('/projects/live');
  const bob = v.openWs('/projects/live');
  const seen: Array<{ message: unknown; from: string }> = [];
  bob.onMessage((message, from) => seen.push({ message, from }));
  const aliceSeen: unknown[] = [];
  alice.onMessage((message) => aliceSeen.push(message));
  alice.send({ type: 'project.created', id: 'p-2' });
  check('e2e: ws broadcast reaches other clients (not sender)', seen.length === 1 && (seen[0].message as { id: string }).id === 'p-2' && aliceSeen.length === 0, `bob=${seen.length} alice=${aliceSeen.length}`);
  alice.close();
  bob.close();

  const stats = v.getStats();
  check('e2e: request telemetry accumulated', stats.requests >= 8 && stats.requestsByRoute['POST /projects'] === 4, `requests=${stats.requests} avg=${stats.avgLatencyMs.toFixed(2)}ms`);
  check('e2e: zero-overhead in-memory (no rows leaked after deletes)', stats.rows === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 5 SMOKE ===');
  crossRepoSuite();
  await sandboxSuite();
  await cascadeSuite();
  await e2eSuite();
  summary(5);
}

void main();
