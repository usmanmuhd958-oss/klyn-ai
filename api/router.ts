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
  repoRoot?: string;
  /** Token override (tests). Defaults to KLYN_ADMIN_TOKEN. */
  token?: string;
  rateLimit?: { windowMs?: number; max?: number };
}

const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 100 };

/** Fill engine defaults so the surface works out of the box. */
function resolveDeps(deps: Phase9Deps = {}): Required<Pick<Phase9Deps, 'graph' | 'profiler' | 'quantum' | 'epoch'>> & Phase9Deps {
  const graph = deps.graph ?? new GraphQueryEngine();
  const profiler = deps.profiler ?? new RuntimeProfiler();
  const quantum = deps.quantum ?? new QuantumZkLedger('klyn-headless-master');
  const epoch = deps.epoch ?? new EpochDriver({ quantum, persistence: deps.persistence });
  return { ...deps, graph, profiler, quantum, epoch };
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

    return fail('NOT_FOUND', `No Phase 9 route for ${method} ${path}`, 404);
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

  router.post('/v1/autonomous/heal', requireToken, asyncHandler(async (req: any, res: any) => {
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
export default router;
export { router, createRouter };
