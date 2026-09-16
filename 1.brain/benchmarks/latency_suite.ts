// =============================================================================
// KLYN AI OS — 1.brain — Ultra-Low Latency Benchmarking Suite (Phase 12)
// File: 1.brain/benchmarks/latency_suite.ts
//
// Phase 12 capability #3. Automated latency micro-benchmarks that verify the
// Phase 12 SLA budgets on the real engines:
//
//   AST graph traversal      budget < 10ms   (Phase 8 GraphQueryEngine)
//   Temporal time-travel     budget <  5ms   (Phase 11 rewind)
//   Seed verification        budget < 20ms   (Phase 11 SelfReplicator)
//   CRDT state sync          budget <  2ms   (Phase 11 mergeLogs)
//
// plus STRESS LOAD tests simulating multi-agent concurrency up to
// 10,000 requests/sec while keeping those same engines inside their SLA
// boundaries:
//
//   temporal rewind stress   10,000 ops, floor 10,000 ops/sec
//   consensus vote stress    10,000 votes, floor 10,000 ops/sec
//
// The suite is headless, deterministic (median + p95 over N iterations,
// budgets are hard assertions) and self-contained — no servers, no network.
// It is invoked by the Phase 12 smoke (`smoke:phase12`) and exposed live via
// GET /v1/benchmarks/run.
//
//   const report = await runLatencySuite();
//   report.passed  — every budget and throughput floor met
//
// Run standalone:  bun run 1.brain/benchmarks/latency_suite.ts
// =============================================================================
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GraphQueryEngine } from '../graph_query_engine.js';
import { TemporalCausality, HybridLogicalClock } from '../temporal_causality.js';
import { SelfReplicator } from '../self_replication.js';
import { ConsensusIsolation } from '../consensus_isolation.js';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export interface BenchResult {
  name: string;
  budgetMs: number;
  iterations: number;
  medianMs: number;
  p95Ms: number;
  passed: boolean;
}

export interface StressResult {
  name: string;
  ops: number;
  elapsedMs: number;
  opsPerSec: number;
  floorOpsPerSec: number;
  passed: boolean;
}

export interface LatencyReport {
  benches: BenchResult[];
  stress: StressResult[];
  passed: boolean;
  at: number;
}

// -----------------------------------------------------------------------------
// STATISTICS
// -----------------------------------------------------------------------------

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))];
}

async function bench(name: string, budgetMs: number, iterations: number, fn: () => unknown | Promise<unknown>): Promise<BenchResult> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  const medianMs = median(samples);
  return { name, budgetMs, iterations, medianMs, p95Ms: p95(samples), passed: medianMs <= budgetMs };
}

function stress(name: string, ops: number, floorOpsPerSec: number, fn: () => void): StressResult {
  const t0 = performance.now();
  for (let i = 0; i < ops; i++) fn();
  const elapsedMs = performance.now() - t0;
  const opsPerSec = Math.round((ops / elapsedMs) * 1000);
  return { name, ops, elapsedMs, opsPerSec, floorOpsPerSec, passed: opsPerSec >= floorOpsPerSec };
}

// -----------------------------------------------------------------------------
// THE SUITE
// -----------------------------------------------------------------------------

export async function runLatencySuite(): Promise<LatencyReport> {
  const benches: BenchResult[] = [];
  const stressRuns: StressResult[] = [];

  // ── 1) AST GRAPH TRAVERSAL (< 10ms) — Phase 8 blast-radius query ─────────
  {
    const graph = new GraphQueryEngine();
    for (let i = 0; i < 1500; i++) graph.addFile(`src/mod_${i}.ts`, ['fn']);
    graph.addFile('core/hub.ts', ['hub']);
    for (let i = 0; i < 1000; i++) graph.addImport(`src/mod_${i}.ts`, 'core/hub.ts');
    benches.push(await bench('graph: blast-radius traversal (1000 importers)', 10, 50, () => {
      graph.execute({ kind: 'blast_radius', target: 'core/hub.ts' });
    }));
  }

  // ── 2) TEMPORAL TIME-TRAVEL (< 5ms) — Phase 11 rewind over 2000 events ────
  {
    const temporal = new TemporalCausality({ nodeId: 'bench-t', clock: new HybridLogicalClock('bench-t', () => 1_000_000) });
    temporal.snapshot('src/app.ts', 'v0');
    for (let i = 1; i < 2000; i++) temporal.mutate('src/app.ts', `v${i - 1}`, `v${i}`);
    benches.push(await bench('temporal: rewind(1000) over 2000 events', 5, 50, () => {
      temporal.rewind(1000);
    }));
  }

  // ── 3) SEED VERIFICATION (< 20ms) — Phase 11 verifyTree over 200 files ────
  {
    const root = mkdtempSync(join(tmpdir(), 'klyn-p12-seedbench-'));
    try {
      for (let i = 0; i < 200; i++) {
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src', `file_${i}.ts`), `export const v${i} = ${i};\n${'// padding '.repeat(60)}\n`);
      }
      const replicator = new SelfReplicator();
      const seed = await replicator.generateSeed(root);
      benches.push(await bench('replicate: verifyTree over 200 files', 20, 20, () => replicator.verifyTree(seed, root)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // ── 4) CRDT STATE SYNC (< 2ms) — Phase 11 mergeLogs of two 500-event logs ─
  {
    const a = new TemporalCausality({ nodeId: 'bench-a', clock: new HybridLogicalClock('bench-a', () => 2_000_000) });
    const b = new TemporalCausality({ nodeId: 'bench-b', clock: new HybridLogicalClock('bench-b', () => 2_000_000) });
    for (let i = 0; i < 500; i++) {
      a.mutate('src/app.ts', `a${i}`, `a${i + 1}`);
      b.mutate('src/lib.ts', `b${i}`, `b${i + 1}`);
    }
    benches.push(await bench('sync: causal mergeLogs of two 500-event logs', 2, 100, () => {
      TemporalCausality.mergeLogs(a.logSnapshot(), b.logSnapshot());
    }));
  }

  // ── STRESS 1: 10,000 temporal rewinds (multi-agent time-travel load) ──────
  {
    const temporal = new TemporalCausality({ nodeId: 'bench-s', clock: new HybridLogicalClock('bench-s', () => 3_000_000) });
    temporal.snapshot('src/app.ts', 'v0');
    for (let i = 1; i < 50; i++) temporal.mutate('src/app.ts', `v${i - 1}`, `v${i}`);
    stressRuns.push(stress('stress: 10k temporal rewinds', 10_000, 10_000, () => {
      temporal.rewind(25);
    }));
  }

  // ── STRESS 2: 10,000 consensus votes (multi-agent BFT load) ───────────────
  {
    const consensus = new ConsensusIsolation({ nodeId: 'bench-c', quorumSize: 7 });
    const proposal = consensus.propose({ proposer: 'bench-c', kind: 'patch', ref: 'src/app.ts', input: 'v0', output: 'v1' }, 'bench-secret');
    stressRuns.push(stress('stress: 10k consensus votes', 10_000, 10_000, () => {
      consensus.castVote(proposal.id, `stress-voter-${Math.floor(Math.random() * 1000)}`, true, 'stress');
    }));
  }

  const passed = benches.every((b) => b.passed) && stressRuns.every((s) => s.passed);
  return { benches, stress: stressRuns, passed, at: Date.now() };
}

// -----------------------------------------------------------------------------
// STANDALONE RUNNER
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 12 LATENCY SUITE ===');
  const report = await runLatencySuite();
  for (const b of report.benches) {
    console.log(`${b.passed ? 'PASS' : 'FAIL'}  ${b.name}  median=${b.medianMs.toFixed(3)}ms p95=${b.p95Ms.toFixed(3)}ms budget=${b.budgetMs}ms (${b.iterations} iters)`);
  }
  for (const s of report.stress) {
    console.log(`${s.passed ? 'PASS' : 'FAIL'}  ${s.name}  ${s.ops} ops in ${s.elapsedMs.toFixed(1)}ms = ${s.opsPerSec.toLocaleString()} ops/sec (floor ${s.floorOpsPerSec.toLocaleString()})`);
  }
  console.log(`\n=== LATENCY SUITE SUMMARY: ${report.passed ? 'ALL BUDGETS MET' : 'BUDGET VIOLATION'} ===`);
  if (!report.passed) process.exit(1);
}

// Run directly: bun run 1.brain/benchmarks/latency_suite.ts
if (process.argv[1] && process.argv[1].endsWith('latency_suite.ts')) {
  await main();
}

export default runLatencySuite;
