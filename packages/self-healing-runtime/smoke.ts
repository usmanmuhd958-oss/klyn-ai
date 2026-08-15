// =============================================================================
// KLYN AI OS — Phase 3 Smoke Test
// File: packages/self-healing-runtime/smoke.ts
//
// Run:  bun run smoke:phase3   (or: bun run packages/self-healing-runtime/smoke.ts)
//
// Covers all four Phase 3 capabilities:
//   1. AST-driven structural context engine (semantic subgraph + call graph)
//   2. self-healing mutation loop (validation retry, deterministic rollback)
//   3. multi-agent swarm orchestrator (timeouts, event bus, state machine)
//   4. synthetic mutation harness + quality gates
// =============================================================================
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IndexStore } from '../../src/indexer/index-store.js';
import { StructuralContextEngine } from '../../1.brain/structural_context.js';
import { MutationLoop, computeAstHints } from './src/healing_loop.js';
import { InlinePatchValidator } from './src/patch_validator.js';
import { QualityGate, synthesizeEdgeCaseMutations, generatePropertyTests } from './src/mutation_harness.js';
import { AgentSwarm } from '../../1.brain/swarm/AgentSwarm.js';
import { AgentOrchestrator } from '../../1.brain/swarm/AgentOrchestrator.js';
import { EventBus } from '../core-runtime/src/EventBus.js';
import { PatchPlanner } from '../../1.brain/patch_planner.js';

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
  const dir = mkdtempSync(join(tmpdir(), 'klyn-p3-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(dir, rel.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AST-DRIVEN STRUCTURAL CONTEXT ENGINE
// ─────────────────────────────────────────────────────────────────────────────
async function structuralContextSuite(): Promise<void> {
  const dir = fixture('fixture', {
    'math.ts': `export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const VERSION = '1';\n`,
    'calc.ts': `import { add } from './math.js';\n\nexport function compute(x: number): number {\n  return add(x, 1);\n}\n`,
    'app.ts': `import { compute } from './calc.js';\n\nexport function run(): number {\n  return compute(5);\n}\n`,
  });

  const engine = new StructuralContextEngine(new IndexStore());
  const delta = await engine.refresh(dir);
  check('structural: refresh produced a changed delta', delta.changed, `${delta.added.join(',')}`);

  const graph = engine.resolveSemanticGraph('compute');
  check('structural: subgraph resolves declarer (calc.ts)', graph.nodes.some((n) => n.file === 'calc.ts'));
  check('structural: subgraph resolves caller (app.ts)', graph.nodes.some((n) => n.file === 'app.ts'));
  check(
    'structural: subgraph has call edge app.ts → compute',
    graph.callEdges.some((e) => e.from === 'app.ts' && e.callee === 'compute'),
    JSON.stringify(graph.callEdges.map((e) => `${e.from}->${e.callee}`))
  );
  check('structural: symbol resolution matched "compute"', graph.symbols.includes('compute'));
  check('structural: latency < 50ms', graph.latencyMs < 50, `${graph.latencyMs.toFixed(2)}ms`);
  check(
    'structural: getCallers(compute) = [app.ts]',
    engine.getCallers('compute').join(',') === 'app.ts',
    engine.getCallers('compute').join(',')
  );
  check(
    'structural: getCallers(add) = [calc.ts]',
    engine.getCallers('add').join(',') === 'calc.ts',
    engine.getCallers('add').join(',')
  );

  // Incremental invalidation hook: rewrite calc.ts so it stops calling add().
  const changed = `import { add } from './math.js';\n\nexport function compute(x: number): number {\n  return x + 2;\n}\n`;
  await engine.onFileWrite('calc.ts', changed, dir);
  check(
    'structural: onFileWrite invalidates call edge (add callers now empty)',
    engine.getCallers('add').length === 0,
    JSON.stringify(engine.getCallers('add'))
  );
  await engine.onFileWrite('calc.ts', readFileSync(join(dir, 'calc.ts'), 'utf-8'), dir);
  check(
    'structural: re-ingest restores call edge',
    engine.getCallers('add').join(',') === 'calc.ts',
    engine.getCallers('add').join(',')
  );

  rmSync(dir, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) SELF-HEALING MUTATION LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function healingLoopSuite(): Promise<void> {
  const original = `export function parse(json: string): unknown {\n  return JSON.parse(json);\n}\n`;
  const healed = `${original}// healed by mutation loop\n`;

  // A) Converge: first candidate is broken, second is valid.
  {
    const dir = fixture('file', { 'buggy.ts': original });
    const filePath = join(dir, 'buggy.ts');
    const loop = new MutationLoop();
    let sawErrorTrace = false;
    const outcome = await loop.heal({
      filePath,
      originalCode: original,
      errorTrace: 'TypeError: malformed JSON input',
      maxIterations: 3,
      generateCandidate: (ctx) => {
        if (ctx.errorTrace === 'TypeError: malformed JSON input') sawErrorTrace = true;
        return ctx.iteration === 1 ? 'export function parse(json: string {' : healed;
      },
      verify: () => ({ ok: true, errors: [] }),
    });
    check('heal: converges on iteration 2', outcome.success && outcome.iterations === 2, `iterations=${outcome.iterations}`);
    check('heal: file contains healed candidate', readFileSync(filePath, 'utf-8') === healed);
    check('heal: error trace injected into candidate context', sawErrorTrace);
    rmSync(dir, { recursive: true, force: true });
  }

  // B) Deterministic rollback: valid candidate but verification fails.
  {
    const dir = fixture('file', { 'buggy.ts': original });
    const filePath = join(dir, 'buggy.ts');
    const loop = new MutationLoop();
    const outcome = await loop.heal({
      filePath,
      originalCode: original,
      maxIterations: 3,
      generateCandidate: () => healed,
      verify: () => ({ ok: false, errors: ['simulated test failure'] }),
    });
    check(
      'heal: failed verification rolls back to EXACT original after 3 iterations',
      !outcome.success && outcome.iterations === 3 && outcome.rolledBack && readFileSync(filePath, 'utf-8') === original,
      `iterations=${outcome.iterations} errors=${outcome.errors.length}`
    );
    rmSync(dir, { recursive: true, force: true });
  }

  // C) Convergence bound: never-valid candidates never touch disk.
  {
    const dir = fixture('file', { 'buggy.ts': original });
    const filePath = join(dir, 'buggy.ts');
    const loop = new MutationLoop();
    const outcome = await loop.heal({
      filePath,
      originalCode: original,
      maxIterations: 3,
      generateCandidate: () => 'export function parse(json: string {', // unbalanced forever
    });
    check(
      'heal: invalid candidates never applied, file untouched after 3 iterations',
      !outcome.success && !outcome.applied && outcome.iterations === 3 && readFileSync(filePath, 'utf-8') === original,
      `iterations=${outcome.iterations} applied=${outcome.applied}`
    );
    rmSync(dir, { recursive: true, force: true });
  }

  // D) AST diff hints are computed correctly.
  {
    const before = 'export function a(): void {\n  return;\n}\n';
    const after = 'export function a(): void {\n  return;\n}\n\nexport function b(): void {\n  return;\n}\n';
    const hints = computeAstHints(before, after);
    check(
      'heal: AST hints detect symbol_added',
      hints.some((h) => h.type === 'symbol_added' && h.symbol === 'b'),
      JSON.stringify(hints)
    );
    check(
      'heal: AST hints unchanged symbols not flagged',
      !hints.some((h) => h.type === 'symbol_changed' && h.symbol === 'a'),
      JSON.stringify(hints)
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) MULTI-AGENT SWARM ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────
async function orchestratorSuite(): Promise<void> {
  const bus = new EventBus();
  const events: Array<{ type: string; payload: any }> = [];
  const unsub = bus.subscribe('swarm:epoch:committed', (e) => events.push({ type: e.type, payload: e.payload }));
  const unsubState = bus.subscribe('swarm:state', (e) => events.push({ type: e.type, payload: e.payload }));

  const original = `export const ok: number = 1;\n`;
  const candidate = `export const ok: number = 2;\n`;
  const dir = fixture('repo', { 'route.ts': original });

  const planner = new PatchPlanner();
  const swarm = new AgentSwarm(planner);
  const orchestrator = new AgentOrchestrator(swarm, bus);

  const record = await orchestrator.dispatch({
    id: 'epoch-1',
    query: 'bump the route constant',
    operations: [{ type: 'modify', path: join(dir, 'route.ts'), oldContent: original, newContent: candidate }],
    repoRoot: dir,
    timeoutMs: 15000,
  });

  check('swarm: epoch committed', record.committed, `state=${record.state}`);
  check('swarm: four votes collected', record.votes.length === 4, `votes=${record.votes.length}`);
  check('swarm: file written with candidate', readFileSync(join(dir, 'route.ts'), 'utf-8') === candidate);
  check('swarm: state machine ended committed', orchestrator.state === 'committed');
  check(
    'swarm: event bus received epoch:committed + state transitions',
    events.some((e) => e.type === 'swarm:epoch:committed') && events.some((e) => e.type === 'swarm:state'),
    `events=${events.map((e) => e.type).join(',')}`
  );
  unsub();
  unsubState();

  // Timeout path: a stalled epoch must be flagged timed_out (never commits).
  const stalled = { runEpochOps: () => new Promise(() => { /* never settles */ }) } as unknown as AgentSwarm;
  const timeoutOrch = new AgentOrchestrator(stalled, bus);
  const timedOut = await timeoutOrch.dispatch({
    id: 'epoch-timeout',
    query: 'stall',
    operations: [],
    timeoutMs: 20,
  });
  check(
    'swarm: strict timeout flags epoch as timed_out',
    timedOut.state === 'timed_out' && timeoutOrch.state === 'timed_out',
    `state=${timedOut.state}`
  );
  check(
    'swarm: timeout error names the budget',
    timedOut.errors[0]?.includes('execution budget') === true,
    timedOut.errors[0] ?? ''
  );

  rmSync(dir, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) SYNTHETIC MUTATION HARNESS + QUALITY GATES
// ─────────────────────────────────────────────────────────────────────────────
function qualityGateSuite(): void {
  const gate = new QualityGate();
  const clean = `export async function handle(body: unknown): Promise<{ status: number }> {\n  try {\n    return { status: JSON.parse(String(body ?? '{}')) ? 200 : 400 };\n  } catch {\n    return { status: 400 };\n  }\n}\n`;
  const risky = `export function load(): Promise<unknown> {\n  return fetch('/api/data').then((r) => r.json());\n}\n`;
  const covered = `export function safe(): void {\n  const p = Promise.resolve(1);\n  p.catch(() => undefined);\n}\n`;

  const approved = gate.evaluate({ code: clean, coverageBefore: 0.8, coverageAfter: 0.8 });
  check('gate: clean patch approved', approved.approved, JSON.stringify(approved.reasons));

  const rejected = gate.evaluate({ code: risky });
  check(
    'gate: unhandled-rejection patch rejected',
    !rejected.approved && rejected.reasons.some((r) => r.startsWith('Unhandled-promise-rejection')),
    rejected.reasons[0] ?? ''
  );

  const coverageDrop = gate.evaluate({ code: clean, coverageBefore: 0.9, coverageAfter: 0.6 });
  check(
    'gate: coverage drop rejected',
    !coverageDrop.approved && coverageDrop.reasons.some((r) => r.startsWith('Coverage gate')),
    coverageDrop.reasons[0] ?? ''
  );

  check('gate: handled promise chain not flagged', !gate.hasUnhandledRejections(covered));

  const validator = new InlinePatchValidator();
  const report = validator.validate('export const x: number = 1;');
  check('validator: clean snippet valid', report.valid);
  const bad = validator.validate('export function broken(: number {');
  check('validator: broken snippet invalid', !bad.valid, bad.errors[0] ?? '');

  const route = {
    method: 'POST' as const,
    path: '/api/users',
    handlerName: 'createUser',
    bodySchema: { name: 'string', age: 'number' },
  };
  const mutations = synthesizeEdgeCaseMutations(route);
  check(
    'harness: synthesizes base + per-field edge cases',
    mutations.length >= 7,
    `mutations=${mutations.length}`
  );
  check(
    'harness: wrong-type mutation targets each schema field',
    mutations.some((m) => m.name.includes('name')) && mutations.some((m) => m.name.includes('age'))
  );
  const tests = generatePropertyTests(route);
  check(
    'harness: property tests generated (describe + it + latency budget)',
    tests.includes('describe(') && tests.includes("it('rejects") && tests.includes('latency budget'),
    `${tests.length} chars`
  );
  check(
    'harness: generated test source stays compact (oversized body not inlined)',
    tests.length < 8000,
    `${tests.length} chars`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 3 SMOKE ===');
  await structuralContextSuite();
  await healingLoopSuite();
  await orchestratorSuite();
  qualityGateSuite();
  console.log(`\n=== PHASE 3 SMOKE SUMMARY: ${passes}/${passes + failures} checks passed ===`);
  if (failures > 0) process.exit(1);
}

void main();
