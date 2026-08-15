'use strict';

// =============================================================================
// KLYN AI OS — Public Authenticated Headless API Surface (Phase 9)
// File: api/router.ts
//
// Phase 9 capability #3. Exposes the autonomous engines behind a strict,
// token-authenticated, rate-limited JSON-REST surface:
//
//   POST /v1/graph/query       — headless AST & symbol graph queries
//   GET  /v1/system/metrics    — real-time profiler metrics + violations
//   GET  /v1/audit/verify      — post-quantum cryptographic audit proofs
//   POST /v1/autonomous/heal   — trigger a full autonomous epoch (fuzzer or
//                                profiler finding) with zero human input
//
// Two mountable surfaces share ONE implementation core:
//   1. `createRouter(deps)`        — Express router (drop-in for existing
//                                    gateways; composition-root injected).
//   2. `createPhase9Handler(deps)` — framework-free request handler
//                                    `({method,url,headers,body}) → {status,body}`
//                                    used by klyn_server.js (Bun runtime) and
//                                    by the Phase 9 smoke suite — no server
//                                    process needed to verify the surface.
//
// Authorization: Bearer token compared in constant time against
// KLYN_ADMIN_TOKEN (same env var as the unified gateway). When no token is
// configured the surface is CLOSED (401) — it never falls open.
//
// Rate limiting: the dependency-free kernel rate limiter (sweep + bounded
// buckets + validated proxy headers) on every Phase 9 route.
// =============================================================================

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

import os from 'node:os';
import crypto from 'node:crypto';
import { withRetryAndCircuit } from '../kernel/backoff.js';

// Phase 9 engine wiring (runtime imports — resolved by Bun; this module is
// never imported by the plain-node gateway unless the runtime supports it).
import { GraphQueryEngine } from '../1.brain/graph_query_engine.js';
import { RuntimeProfiler } from '../1.brain/runtime_profiler.js';
import { QuantumZkLedger } from '../kernel/src/security/quantum_zk.js';
import { EpochDriver, type EpochFinding } from '../1.brain/e2e_autonomous_epoch.js';
import { SelfHostingLoop } from '../1.brain/self_hosting_loop.js';
import { TemporalCausality, HybridLogicalClock } from '../1.brain/temporal_causality.js';
import { SelfReplicator } from '../1.brain/self_replication.js';
import { FederatedMesh } from '../packages/swarm-mesh/src/federated_mesh.js';
import { MeshStorage } from '../packages/swarm-mesh/src/mesh_storage.js';
import { MeshHealer } from '../packages/swarm-mesh/src/mesh_healer.js';
import { ConsensusIsolation } from '../1.brain/consensus_isolation.js';
import { QuorumEpochLoop } from '../1.brain/swarm/QuorumEpochLoop.js';
import { runLatencySuite } from '../1.brain/benchmarks/latency_suite.js';
import { rateLimiter } from '../kernel/src/services/rate_limiter.js';
import type { EnginePersistence } from '../kernel/src/storage/persistent_ledger.js';

// Hard dependencies (declared in package.json)
const express = require('express');
const cors = require('cors');

// Optional dependencies — graceful no-op fallbacks so the router can always be
// mounted even when these packages are not installed.
let helmet: any = () => (_req: any, _res: any, next: any) => next();
let pino: any = () => ({ info() {}, warn() {}, error() {} });
let Ajv: any = class AjvCompat { compile() { return () => true; } };

try { helmet = require('helmet'); } catch (_) {}
try { pino = require('pino'); } catch (_) {}
try { Ajv = require('ajv'); } catch (_) {}

// Optional Supabase client (gracefully falls back if not configured).
let supabase: any = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
} catch (_) {}

// ---------------------------------------------------------------------------
// Structured Logger (Pino)
// ---------------------------------------------------------------------------
const logger = pino({
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  level: process.env.LOG_LEVEL || 'info',
});

// ---------------------------------------------------------------------------
// PHASE 9 ENGINE COMPOSITION ROOT
// ---------------------------------------------------------------------------

export interface Phase9Deps {
  graph?: GraphQueryEngine;
  profiler?: RuntimeProfiler;
  quantum?: QuantumZkLedger;
  epoch?: EpochDriver;
  persistence?: EnginePersistence;
  /** Phase 10 self-hosting loop (guarded dogfood driver for /v1/self/*). */
  selfHosting?: SelfHostingLoop;
  /** Phase 11 temporal causality engine (HLC + time travel + causal sync). */
  temporal?: TemporalCausality;
  /** Phase 11 self-replicator (seed generation + bootstrap verification). */
  replicator?: SelfReplicator;
  /** Phase 12 federated replica swarm (peer registry + causal sync). */
  mesh?: FederatedMesh;
  /** Phase 12 lock-free BFT consensus engine (quorum + quarantine). */
  consensus?: ConsensusIsolation;
  /** Phase 13 durable mesh topology store (JSON-L). */
  meshStorage?: MeshStorage;
  /** Phase 13 self-healing mesh convergence engine. */
  meshHealer?: MeshHealer;
  /** Phase 13 quorum-gated swarm epoch loop. */
  quorumLoop?: QuorumEpochLoop;
  repoRoot?: string;
  /** Token override (tests). Defaults to KLYN_ADMIN_TOKEN. */
  token?: string;
  rateLimit?: { windowMs?: number; max?: number };
}

const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 100 };

/** Fill engine defaults so the surface works out of the box. */
function resolveDeps(deps: Phase9Deps = {}): Required<Pick<Phase9Deps, 'graph' | 'profiler' | 'quantum' | 'epoch' | 'selfHosting' | 'temporal' | 'replicator' | 'mesh' | 'consensus' | 'meshHealer' | 'quorumLoop'>> & Phase9Deps {
  const graph = deps.graph ?? new GraphQueryEngine();
  const profiler = deps.profiler ?? new RuntimeProfiler();
  const quantum = deps.quantum ?? new QuantumZkLedger('klyn-headless-master');
  const epoch = deps.epoch ?? new EpochDriver({ quantum, persistence: deps.persistence });
  const selfHosting = deps.selfHosting ?? new SelfHostingLoop({ repoRoot: deps.repoRoot ?? process.cwd(), persistence: deps.persistence });
  const temporal = deps.temporal ?? new TemporalCausality({ nodeId: process.env.KLYN_NODE_ID ?? 'klyn-headless' });
  const replicator = deps.replicator ?? new SelfReplicator();
  const mesh = deps.mesh ?? new FederatedMesh({ nodeId: temporal.stats().nodeId, temporal });
  const consensus = deps.consensus ?? new ConsensusIsolation({ nodeId: temporal.stats().nodeId });
  const meshHealer = deps.meshHealer ?? new MeshHealer(mesh, deps.meshStorage);
  const quorumLoop = deps.quorumLoop ?? new QuorumEpochLoop({ consensus, voters: [] });
  return { ...deps, graph, profiler, quantum, epoch, selfHosting, temporal, replicator, mesh, consensus, meshHealer, quorumLoop };
}

// ---------------------------------------------------------------------------
// AUTH (constant-time bearer token) + RATE LIMITING (bounded, swept)
// ---------------------------------------------------------------------------

function resolveToken(deps: Phase9Deps): string | null {
  return deps.token ?? process.env.KLYN_ADMIN_TOKEN ?? null;
}

function tokenMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bearerToken(headers: Record<string, unknown>): string | null {
  const raw = headers['authorization'] ?? headers['Authorization'];
  const header = Array.isArray(raw) ? raw[0] : String(raw ?? '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Fixed-window per-IP limiter with bounded buckets + periodic sweep
 *  (the express router uses the kernel rateLimiter middleware instead; this
 *  is the framework-free twin for the headless handler). */
class FixedWindowLimiter {
  private hits = new Map<string, number[]>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly windowMs: number,
    private readonly max: number
  ) {
    this.timer = setInterval(() => this.sweep(), windowMs);
    this.timer.unref?.();
  }

  allow(key: string): boolean {
    const now = Date.now();
    const alive = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (alive.length >= this.max) {
      this.hits.set(key, alive);
      return false;
    }
    alive.push(now);
    this.hits.set(key, alive);
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, stamps] of this.hits) {
      const alive = stamps.filter((t) => now - t < this.windowMs);
      if (alive.length === 0) this.hits.delete(key);
      else this.hits.set(key, alive);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function clientKey(headers: Record<string, unknown>): string {
  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0].trim();
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(first) || /^[0-9a-fA-F:]{2,45}$/.test(first)) return first;
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// CORE HANDLERS (shared by the Express router and the headless handler)
// ---------------------------------------------------------------------------

export interface HeadlessRequest {
  method: string;
  url: string;
  headers: Record<string, unknown>;
  body?: unknown;
}

export interface HeadlessResponse {
  status: number;
  body: unknown;
}

const ok = (data: unknown, status = 200): HeadlessResponse => ({
  status,
  body: { success: true, data, timestamp: new Date().toISOString() },
});

const fail = (code: string, message: string, status: number, details: unknown = null): HeadlessResponse => ({
  status,
  body: { success: false, error: { code, message, details }, timestamp: new Date().toISOString() },
});

function routePath(url: string): { path: string; query: URLSearchParams } {
  const qIdx = url.indexOf('?');
  const path = qIdx === -1 ? url : url.slice(0, qIdx);
  const query = new URLSearchParams(qIdx === -1 ? '' : url.slice(qIdx + 1));
  return { path, query };
}

/** Execute one Phase 9 route. Throws only on programmer error; every client
 *  condition returns a structured HeadlessResponse. When `limiter` is
 *  provided (the framework-free handler passes its persistent limiter) the
 *  per-IP window is enforced here; the Express router enforces limits via the
 *  kernel rateLimiter middleware instead, so no limiter is passed. */
export async function handlePhase9Request(req: HeadlessRequest, deps: Phase9Deps = {}, limiter?: FixedWindowLimiter): Promise<HeadlessResponse> {
  const d = resolveDeps(deps);
  const { path, query } = routePath(req.url);
  const method = (req.method || 'GET').toUpperCase();

  // The four Phase 9 routes are all authenticated.
  const expected = resolveToken(deps);
  if (!expected) {
    return fail('AUTH_NOT_CONFIGURED', 'KLYN_ADMIN_TOKEN is not configured — Phase 9 surface is closed', 503);
  }
  const token = bearerToken(req.headers);
  if (!token || !tokenMatches(token, expected)) {
    return fail('UNAUTHORIZED', 'Valid Bearer token required', 401);
  }

  if (limiter && !limiter.allow(clientKey(req.headers))) {
    return fail('RATE_LIMITED', 'Too many requests, please try again later.', 429);
  }

  {

    // ── POST /v1/graph/query — headless AST & symbol graph query ────────────
    if (method === 'POST' && path === '/v1/graph/query') {
      const payload = (req.body ?? {}) as { query?: unknown };
      if (typeof payload.query !== 'object' || payload.query === null) {
        return fail('VALIDATION_ERROR', 'Body must be { "query": { kind, target, ... } }', 422);
      }
      const result = d.graph.execute(payload.query as Parameters<GraphQueryEngine['execute']>[0]);
      if (!result.ok) return fail('GRAPH_QUERY_FAILED', result.error ?? 'graph query failed', 422, result);
      return ok(result);
    }

    // ── GET /v1/system/metrics — real-time profiler snapshot ───────────────
    if (method === 'GET' && path === '/v1/system/metrics') {
      const routes = d.profiler.routes();
      const perRoute = routes.map((route) => ({
        route,
        stats: d.profiler.statsFor(route),
        violations: d.profiler.evaluate(route),
        filePath: d.profiler.sampleFilePath(route),
      }));
      const mem = process.memoryUsage();
      return ok({
        profiler: d.profiler.getStats(),
        routes: perRoute,
        process: { uptime: process.uptime(), heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss },
        loadAvg: os.loadavg(),
        epoch: d.epoch.getStats(),
      });
    }

    // ── GET /v1/audit/verify — post-quantum audit proofs ───────────────────
    if (method === 'GET' && path === '/v1/audit/verify') {
      const verdict = d.quantum.verify();
      const seqParam = query.get('seq');
      let proof: unknown = null;
      if (seqParam !== null) {
        const seq = Number(seqParam);
        if (!Number.isInteger(seq) || seq < 1) return fail('VALIDATION_ERROR', 'seq must be a positive integer', 422);
        proof = d.quantum.prove(seq);
        if (proof === null) return fail('AUDIT_SEQ_NOT_FOUND', `no ledger record at seq ${seq}`, 404);
      }
      return ok({ verdict, proof, root: d.quantum.root, records: d.quantum.recordCount });
    }

    // ── GET /v1/audit/export — third-party verifiable audit export ─────────
    // Full post-quantum Merkle chain + per-record non-repudiation checks in a
    // format external auditors can verify with ZERO secrets (each record
    // carries its own WOTS+ public key). Phase 14 capability #3.
    if (method === 'GET' && path === '/v1/audit/export') {
      const records = d.quantum.recordsSnapshot();
      const verify = d.quantum.verify();
      const perRecord = records.map((r) => ({ seq: r.seq, verify: d.quantum.verifyRecord(r.seq) }));
      const seqParam = query.get('seq');
      let proof: unknown = null;
      if (seqParam !== null) {
        const seq = Number(seqParam);
        if (!Number.isInteger(seq) || seq < 1) return fail('VALIDATION_ERROR', 'seq must be a positive integer', 422);
        proof = d.quantum.prove(seq);
        if (proof === null) return fail('AUDIT_SEQ_NOT_FOUND', `no ledger record at seq ${seq}`, 404);
      }
      return ok({
        format: 'klyn-quantum-audit-v1',
        schemaVersion: 1,
        exportAt: new Date().toISOString(),
        root: d.quantum.root,
        records: records.length,
        verify,
        perRecord,
        proof,
        ledger: records,
      });
    }

    // ── POST /v1/autonomous/heal — trigger a full autonomous epoch ─────────
    if (method === 'POST' && path === '/v1/autonomous/heal') {
      const payload = (req.body ?? {}) as Record<string, unknown>;
      const source = String(payload.source ?? 'profiler');
      const repoRoot = (deps.repoRoot ?? process.cwd()) as string;

      if (source === 'profiler') {
        const route = String(payload.route ?? '');
        if (!route) return fail('VALIDATION_ERROR', 'profiler heal requires { route }', 422);
        const outcome = await d.epoch.driveViolation(route, d.profiler, repoRoot);
        if (!outcome.ok) return fail('HEAL_REJECTED', outcome.errors.join('; ') || 'epoch failed', 422, outcome);
        return ok(outcome);
      }

      // fuzzer | manual — a fully-specified finding with an absolute filePath.
      const filePath = String(payload.filePath ?? '');
      const route = String(payload.route ?? '');
      if (!filePath || !route) {
        return fail('VALIDATION_ERROR', `${source} heal requires { route, filePath }`, 422);
      }
      const finding: EpochFinding = {
        source: source === 'fuzzer' ? 'fuzzer' : 'manual',
        route,
        filePath,
        detail: String(payload.detail ?? 'autonomous heal request'),
        kind: String(payload.kind ?? 'injection'),
        severity: String(payload.severity ?? 'high'),
        at: Date.now(),
      };
      const outcome = await d.epoch.drive(finding, repoRoot, String(payload.query ?? ''));
      if (!outcome.ok) return fail('HEAL_REJECTED', outcome.errors.join('; ') || 'epoch failed', 422, outcome);
      return ok(outcome);
    }

    // ── PHASE 10: SELF-HOSTING SURFACE (guarded dogfood API) ───────────────
    // Klyn audits, evolves, and rolls back its OWN source through the same
    // token-authenticated, rate-limited headless surface. All four routes are
    // guarded by the SelfHostingLoop (critical-file protection, convergence
    // locks, blast-radius containment, manual-finding escalation).

    // ── POST /v1/self/audit — scan the OS's own source tree ────────────────
    if (method === 'POST' && path === '/v1/self/audit') {
      const report = await d.selfHosting.audit();
      return ok(report);
    }

    // ── POST /v1/self/evolve — evolve one cached finding (guarded) ─────────
    if (method === 'POST' && path === '/v1/self/evolve') {
      const payload = (req.body ?? {}) as Record<string, unknown>;
      const findingId = String(payload.findingId ?? '');
      if (!findingId) return fail('VALIDATION_ERROR', 'self/evolve requires { findingId } from the last /v1/self/audit', 422);
      const outcome = await d.selfHosting.evolveById(findingId, { force: payload.force === true });
      if (outcome === null) return fail('FINDING_NOT_FOUND', `no cached finding with id ${findingId} — run /v1/self/audit first`, 404);
      if (outcome.vetoed) return fail('SELF_MUTATION_VETOED', outcome.vetoReason ?? 'vetoed', 422, outcome);
      if (!outcome.ok) return fail('SELF_EPOCH_REJECTED', outcome.epoch?.errors.join('; ') ?? 'epoch failed', 422, outcome);
      return ok(outcome);
    }

    // ── GET /v1/self/manifest — tamper-evident evolution record + status ────
    if (method === 'GET' && path === '/v1/self/manifest') {
      const mf = d.selfHosting.manifestRef;
      const entries = mf ? await mf.all() : [];
      const verify = mf ? await mf.verify() : { valid: true, entries: 0, brokenAt: null };
      const status = await d.selfHosting.status();
      return ok({ entries, verify, status });
    }

    // ── POST /v1/self/rollback — byte-exact restore to a manifest seq ──────
    if (method === 'POST' && path === '/v1/self/rollback') {
      const payload = (req.body ?? {}) as Record<string, unknown>;
      const seq = Number(payload.seq ?? NaN);
      if (!Number.isInteger(seq) || seq < 1) return fail('VALIDATION_ERROR', 'self/rollback requires { seq } (positive integer)', 422);
      const result = await d.selfHosting.rollback(seq);
      if (!result.ok) return fail('ROLLBACK_FAILED', result.reason ?? 'rollback failed', 404, result);
      return ok(result);
    }

    // ── PHASE 11: TEMPORAL CAUSALITY SURFACE ───────────────────────────────
    // HLC-stamped causal log, exact time-travel state reconstruction, and
    // happened-before / concurrency queries — the "rewindable universe" of
    // the OS, behind the same token auth + rate limiting.

    // ── GET /v1/temporal/now — HLC time + causal log stats ────────────────
    if (method === 'GET' && path === '/v1/temporal/now') {
      return ok(d.temporal.stats());
    }

    // ── GET /v1/temporal/rewind?seq=N — reconstruct exact state at a point ─
    if (method === 'GET' && path === '/v1/temporal/rewind') {
      const seqParam = query.get('seq');
      const seq = Number(seqParam ?? NaN);
      if (!Number.isInteger(seq) || seq < 0) {
        return fail('VALIDATION_ERROR', 'rewind requires { seq } (integer >= 0)', 422);
      }
      return ok(d.temporal.rewind(seq));
    }

    // ── GET /v1/temporal/causality?a=N&b=M — happened-before verdict ───────
    if (method === 'GET' && path === '/v1/temporal/causality') {
      const a = Number(query.get('a') ?? NaN);
      const b = Number(query.get('b') ?? NaN);
      if (!Number.isInteger(a) || a < 1 || !Number.isInteger(b) || b < 1) {
        return fail('VALIDATION_ERROR', 'causality requires { a, b } (positive integers)', 422);
      }
      const aHlc = d.temporal.hlcOf(a);
      const bHlc = d.temporal.hlcOf(b);
      if (aHlc === null || bHlc === null) {
        return fail('CAUSAL_SEQ_NOT_FOUND', `unknown causal seq (a=${a}, b=${b}) — max is ${d.temporal.seq}`, 404);
      }
      return ok({
        a,
        b,
        aHlc,
        bHlc,
        happenedBefore: HybridLogicalClock.happenedBefore(aHlc, bHlc),
        concurrent: HybridLogicalClock.concurrent(aHlc, bHlc),
      });
    }

    // ── PHASE 11: SELF-REPLICATION SURFACE ─────────────────────────────────
    // The OS proves its own byte identity (seed), re-forges a byte-exact
    // replica (bootstrap), and hands replicas the causal ledger delta (sync)
    // so a fresh clone can catch up to the exact current state.

    // ── POST /v1/replicate/seed — generate + verify own identity seed ──────
    if (method === 'POST' && path === '/v1/replicate/seed') {
      const repoRoot = (deps.repoRoot ?? process.cwd()) as string;
      const seed = await d.replicator.generateSeed(repoRoot);
      const verify = await d.replicator.verifyTree(seed, repoRoot);
      return ok({ seed, verify });
    }

    // ── POST /v1/replicate/bootstrap — re-forge a byte-exact replica ───────
    // Dry-run by default ({ apply: false } → plan only, zero writes).
    if (method === 'POST' && path === '/v1/replicate/bootstrap') {
      const payload = (req.body ?? {}) as Record<string, unknown>;
      const targetDir = String(payload.targetDir ?? '');
      if (!targetDir) return fail('VALIDATION_ERROR', 'bootstrap requires { targetDir }', 422);
      const repoRoot = (deps.repoRoot ?? process.cwd()) as string;
      const result = await d.replicator.bootstrap(repoRoot, targetDir, { apply: payload.apply === true });
      return ok(result);
    }

    // ── GET /v1/replicate/sync?since=N — causal ledger delta for replicas ──
    if (method === 'GET' && path === '/v1/replicate/sync') {
      const sinceParam = query.get('since');
      const since = Number(sinceParam ?? 0);
      if (!Number.isInteger(since) || since < 0) {
        return fail('VALIDATION_ERROR', 'sync requires { since } (integer >= 0)', 422);
      }
      const delta = d.temporal.deltaSince(since);
      return ok({ since, to: d.temporal.seq, delta });
    }

    // ── PHASE 12: FEDERATED REPLICA SWARM SURFACE ───────────────────────────
    // Live cluster view, causal sync triggers, and the live latency/SLA
    // diagnostic suite — same token auth + rate limiting.

    // ── GET /v1/federation/nodes — list active cluster peers ───────────────
    if (method === 'GET' && path === '/v1/federation/nodes') {
      return ok({ nodeId: d.mesh.nodeId, quorum: d.mesh.getStats().peers > 0 ? Math.max(3, d.mesh.getStats().peers) : null, stats: d.mesh.getStats(), nodes: d.mesh.nodes() });
    }

    // ── POST /v1/federation/sync — trigger causal state sync ───────────────
    //   {}                 → broadcast bundle (delta every online peer needs)
    //   { peer }           → catch-up delta for one peer
    //   { peer, delta }    → ingest a peer's delta (receipt)
    if (method === 'POST' && path === '/v1/federation/sync') {
      const payload = (req.body ?? {}) as Record<string, unknown>;
      const peer = String(payload.peer ?? '');
      const delta = Array.isArray(payload.delta) ? (payload.delta as unknown[]) : null;
      if (peer && delta !== null) {
        const receipt = d.mesh.receiveDelta(peer, delta as Parameters<FederatedMesh['receiveDelta']>[1]);
        return ok(receipt);
      }
      if (peer) {
        return ok({ peer, delta: d.mesh.produceDelta(0), localSeq: d.mesh.getStats().localSeq, note: 'delta to push to the peer' });
      }
      return ok({ nodeId: d.mesh.nodeId, peers: d.mesh.onlinePeers(), delta: d.mesh.produceDelta(0), localSeq: d.mesh.getStats().localSeq });
    }

    // ── GET /v1/benchmarks/run — live latency + SLA diagnostic suite ───────
    if (method === 'GET' && path === '/v1/benchmarks/run') {
      const report = await runLatencySuite();
      return ok(report);
    }

    // ── PHASE 13: SELF-HEALING MESH SURFACE ─────────────────────────────────
    // Durable topology view, quarantine control (inspect/quarantine/admit),
    // and explicit convergence triggers — same token auth + rate limiting.

    // ── GET /v1/mesh/topology — durable cluster topology + peer health ──────
    if (method === 'GET' && path === '/v1/mesh/topology') {
      const reputations = d.meshStorage ? await d.meshStorage.restoreReputations() : {};
      const vectorClock = d.meshStorage ? await d.meshStorage.restoreVectorClock() : d.temporal.hlc;
      return ok({
        nodeId: d.mesh.nodeId,
        peers: d.mesh.nodes(),
        reputations,
        vectorClock,
        stats: d.mesh.getStats(),
        healer: d.meshHealer.getStats(),
        consensus: d.consensus.getStats(),
        quorumLoop: d.quorumLoop.getStats(),
      });
    }

    // ── POST /v1/mesh/quarantine — inspect | quarantine | admit ─────────────
    if (method === 'POST' && path === '/v1/mesh/quarantine') {
      const payload = (req.body ?? {}) as Record<string, unknown>;
      const action = String(payload.action ?? 'inspect');
      const nodeId = String(payload.nodeId ?? '');
      if (action === 'quarantine') {
        if (!nodeId) return fail('VALIDATION_ERROR', 'quarantine requires { nodeId }', 422);
        d.consensus.quarantine(nodeId, String(payload.reason ?? 'programmatic quarantine'));
        return ok({ nodeId, quarantined: true, quarantinedList: d.consensus.getStats().quarantined });
      }
      if (action === 'admit') {
        if (!nodeId) return fail('VALIDATION_ERROR', 'admit requires { nodeId }', 422);
        d.consensus.admit(nodeId);
        return ok({ nodeId, quarantined: false, quarantinedList: d.consensus.getStats().quarantined });
      }
      const quarantined = d.consensus.getStats().quarantined;
      const suspicion: Record<string, number> = {};
      for (const q of quarantined) suspicion[q] = d.consensus.suspicionOf(q);
      return ok({ quarantined, suspicion });
    }

    // ── POST /v1/mesh/heal — trigger explicit mesh state convergence ────────
    //   { peer, delta } → converge one reconnecting peer (zero-data-loss
    //                      verified)
    //   { peer }        → the delta this node would push to that peer
    //   {}              → run the monitoring sweep + report pending
    if (method === 'POST' && path === '/v1/mesh/heal') {
      const payload = (req.body ?? {}) as Record<string, unknown>;
      const peer = String(payload.peer ?? '');
      const delta = Array.isArray(payload.delta) ? (payload.delta as unknown[]) : null;
      if (peer && delta !== null) {
        const result = await d.meshHealer.reconnect(peer, delta as Parameters<MeshHealer['reconnect']>[1]);
        if (d.meshStorage) await d.meshStorage.persistTopology(d.mesh.nodes());
        return ok(result);
      }
      if (peer) {
        return ok({ peer, delta: d.mesh.produceDelta(0), note: 'delta to push to the reconnecting peer' });
      }
      const actions = d.meshHealer.tick();
      return ok({ actions, pending: d.meshHealer.pending(), stats: d.meshHealer.getStats() });
    }

    return fail('NOT_FOUND', `No Phase 9-14 route for ${method} ${path}`, 404);
  }
}

/** Framework-free headless handler used by klyn_server.js and the smoke
 *  suite. Returns { status, body } — the caller writes the response. The rate
 *  limiter is created ONCE per handler so the window persists across requests
 *  (a per-request limiter would never trip). */
export function createPhase9Handler(deps: Phase9Deps = {}): (req: HeadlessRequest) => Promise<HeadlessResponse> {
  const d = resolveDeps(deps);
  const handlerDeps: Phase9Deps = { ...deps, ...d };
  const rl = deps.rateLimit ?? DEFAULT_RATE_LIMIT;
  const limiter = new FixedWindowLimiter(rl.windowMs ?? DEFAULT_RATE_LIMIT.windowMs, rl.max ?? DEFAULT_RATE_LIMIT.max);
  return (req: HeadlessRequest) => handlePhase9Request(req, handlerDeps, limiter);
}

// ---------------------------------------------------------------------------
// Standardized Response Helpers (Express)
// ---------------------------------------------------------------------------
function successResponse(res: any, data: unknown, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}

function errorResponse(res: any, code: string, message: string, details: unknown = null, statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    error: { code, message, details },
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Async error wrapper (catches rejected promises)
// ---------------------------------------------------------------------------
function asyncHandler(fn: (...args: any[]) => Promise<void>) {
  return (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------------------------------------------------------------------------
// Router factory — dependencies (engines, Supabase client, logger) are
// injected via a composition root instead of being read from env at import
// time. The default export keeps the legacy behavior (env-based singletons)
// for callers that mount the router without explicit dependencies.
// ---------------------------------------------------------------------------
function createRouter(deps: Phase9Deps & { supabase?: any; logger?: any } = {}) {
  const db = deps.supabase !== undefined ? deps.supabase : supabase;
  const log = deps.logger !== undefined ? deps.logger : logger;

  const router = express.Router();

  // Security middlewares
  router.use(helmet());
  router.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

  // Rate limiting on every route: the kernel limiter is dependency-free,
  // sweeps expired buckets, bounds per-bucket memory, and validates
  // X-Forwarded-For when trusted (default 100 req/min per IP).
  const limiter = rateLimiter({
    windowMs: deps.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT.windowMs,
    max: deps.rateLimit?.max ?? DEFAULT_RATE_LIMIT.max,
    trustProxyHeaders: false,
    handler: (res: any) => errorResponse(res, 'RATE_LIMITED', 'Too many requests, please try again later.', null, 429),
  });
  router.use('/', limiter);

  // Body parser
  router.use(express.json({ limit: '10mb' }));

  // Timing-safe bearer-token guard for the Phase 9 routes.
  const expected = resolveToken(deps);
  const requireToken = (req: any, res: any, next: any) => {
    if (!expected) {
      return errorResponse(res, 'AUTH_NOT_CONFIGURED', 'KLYN_ADMIN_TOKEN is not configured — Phase 9 surface is closed', null, 503);
    }
    const token = bearerToken(req.headers);
    if (!token || !tokenMatches(token, expected)) {
      return errorResponse(res, 'UNAUTHORIZED', 'Valid Bearer token required', null, 401);
    }
    next();
  };

  // -------------------------------------------------------------------------
  // ROUTES (must be declared before error handler)
  // -------------------------------------------------------------------------

  // Health Endpoint (public, minimal)
  router.get('/v1/health', asyncHandler(async (req: any, res: any) => {
    const mem = process.memoryUsage();
    const healthData: any = {
      uptime: process.uptime(),
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
      },
      loadAvg: os.loadavg(),
      freeMem: os.freemem(),
      dbStatus: 'unknown',
    };

    if (db) {
      try {
        await withRetryAndCircuit(
          'supabase-health',
          () => db.from('organizations').select('id', { head: true, count: 'exact' }).limit(1),
          { maxAttempts: 2, baseMs: 100, maxMs: 1000 }
        );
        healthData.dbStatus = 'connected';
      } catch (dbErr) {
        log.warn({ err: dbErr }, 'Database health check failed');
        healthData.dbStatus = 'disconnected';
      }
    }

    successResponse(res, healthData);
  }));

  // Agent Dispatch Endpoint (legacy surface, unchanged)
  const ajv = new Ajv();
  const dispatchSchema = {
    type: 'object',
    properties: {
      agent: { type: 'string', minLength: 1 },
      task: { type: 'string', minLength: 1 },
      priority: { type: 'number', enum: [1, 2, 3], default: 2 },
    },
    required: ['agent', 'task'],
    additionalProperties: false,
  };
  const validateDispatch = ajv.compile(dispatchSchema);

  router.post('/v1/agent/dispatch', asyncHandler(async (req: any, res: any) => {
    const payload = req.body;
    if (!validateDispatch(payload)) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Invalid agent payload', validateDispatch.errors, 422);
    }
    const dispatchResult = {
      agent: payload.agent,
      task: payload.task,
      priority: payload.priority || 2,
      dispatchedAt: new Date().toISOString(),
      status: 'queued',
    };
    log.info({ dispatch: dispatchResult }, 'Agent dispatched');
    successResponse(res, dispatchResult, 202);
  }));

  // ── PHASE 9: Authenticated headless autonomous surface ───────────────────
  // All four routes delegate to the same core handlers as the framework-free
  // surface — one implementation, two mount points.

  router.post('/v1/graph/query', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  router.get('/v1/system/metrics', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  router.get('/v1/audit/verify', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  // ── PHASE 14: hardened audit export — same core handler, same auth ────────
  router.get('/v1/audit/export', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  router.post('/v1/autonomous/heal', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  // ── PHASE 10: Self-hosting surface — same core handlers, same auth ────────
  router.post('/v1/self/audit', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  router.post('/v1/self/evolve', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  router.get('/v1/self/manifest', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  router.post('/v1/self/rollback', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  // ── PHASE 11: Temporal causality + replication surface — same core ───────
  // handlers, same auth, same rate limiting. GET routes pass the full URL so
  // the core handler can read the query string (seq/since/a/b).

  router.get('/v1/temporal/now', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  router.get('/v1/temporal/rewind', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  router.get('/v1/temporal/causality', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  router.post('/v1/replicate/seed', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  router.post('/v1/replicate/bootstrap', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  router.get('/v1/replicate/sync', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  // ── PHASE 12: Federation + benchmarks surface — same core handlers ────────

  router.get('/v1/federation/nodes', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  router.post('/v1/federation/sync', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  router.get('/v1/benchmarks/run', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  // ── PHASE 13: Self-healing mesh surface — same core handlers ──────────────

  router.get('/v1/mesh/topology', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'GET', url: req.url, headers: req.headers }, deps);
    res.status(result.status).json(result.body);
  }));

  router.post('/v1/mesh/quarantine', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  router.post('/v1/mesh/heal', requireToken, asyncHandler(async (req: any, res: any) => {
    const result = await handlePhase9Request({ method: 'POST', url: req.url, headers: req.headers, body: req.body }, deps);
    res.status(result.status).json(result.body);
  }));

  // -------------------------------------------------------------------------
  // Global Error Handler (MUST be the last middleware)
  // -------------------------------------------------------------------------
  router.use((err: any, req: any, res: any, _next: any) => {
    log.error({ err }, 'Unhandled error in API router');
    const statusCode = err.statusCode || 500;
    const code = err.code || 'INTERNAL_ERROR';
    const message = err.message || 'Internal server error';
    const details = process.env.NODE_ENV === 'development' ? err.stack : undefined;
    return errorResponse(res, code, message, details, statusCode);
  });

  return router;
}

// ---------------------------------------------------------------------------
// Default instance (legacy behavior — env-based singletons)
// ---------------------------------------------------------------------------
const router = createRouter();

// ---------------------------------------------------------------------------
// Exports: default router for drop-in mounting, named createRouter for
// dependency-injected composition roots, headless handler for the gateway and
// the smoke suite, and the route list the gateway dispatches on.
// ---------------------------------------------------------------------------
export const PHASE9_ROUTES = ['/v1/graph/query', '/v1/system/metrics', '/v1/audit/verify', '/v1/autonomous/heal'] as const;
export const PHASE10_ROUTES = ['/v1/self/audit', '/v1/self/evolve', '/v1/self/manifest', '/v1/self/rollback'] as const;
export const PHASE11_ROUTES = ['/v1/temporal/now', '/v1/temporal/rewind', '/v1/temporal/causality', '/v1/replicate/seed', '/v1/replicate/bootstrap', '/v1/replicate/sync'] as const;
export const PHASE12_ROUTES = ['/v1/federation/nodes', '/v1/federation/sync', '/v1/benchmarks/run'] as const;
export const PHASE13_ROUTES = ['/v1/mesh/topology', '/v1/mesh/quarantine', '/v1/mesh/heal'] as const;
export const PHASE14_ROUTES = ['/v1/audit/export'] as const;
export default router;
export { router, createRouter };
