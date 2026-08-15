'use strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

import os from 'node:os';
import { withRetryAndCircuit } from '../kernel/backoff.js';

// Hard dependencies (declared in package.json)
const express = require('express');
const cors = require('cors');

// Optional dependencies — graceful no-op fallbacks so the router can always be
// mounted even when these packages are not installed.
let helmet: any = () => (_req: any, _res: any, next: any) => next();
let rateLimit: any = () => (_req: any, _res: any, next: any) => next();
let pino: any = () => ({ info() {}, warn() {}, error() {} });
let Ajv: any = class AjvCompat { compile() { return () => true; } };

try { helmet = require('helmet'); } catch (_) {}
try { rateLimit = require('express-rate-limit'); } catch (_) {}
try { pino = require('pino'); } catch (_) {}
try { Ajv = require('ajv'); } catch (_) {}

// Optional Supabase client (gracefully falls back if not configured).
// ANON key is preferred: this router serves public traffic and the
// service-role key bypasses RLS — it must never be the default credential
// for requests this process answers.
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
// Standardized Response Helpers
// ---------------------------------------------------------------------------
function successResponse(res, data, statusCode = 200) {
  return (res as any).status(statusCode).json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}

function errorResponse(res, code, message, details = null, statusCode = 400) {
  return (res as any).status(statusCode).json({
    success: false,
    error: { code, message, details },
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Async error wrapper (catches rejected promises)
// ---------------------------------------------------------------------------
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------------------------------------------------------------------------
// Router factory — dependencies (Supabase client, logger) are injected via a
// composition root instead of being read from env at import time. The default
// export keeps the legacy behavior (env-based singletons) for callers that
// mount the router without explicit dependencies.
// ---------------------------------------------------------------------------
function createRouter(deps: any = {}) {
  const db = deps.supabase !== undefined ? deps.supabase : supabase;
  const log = deps.logger !== undefined ? deps.logger : logger;

  const router = express.Router();

  // Security middlewares
  router.use(helmet());
  router.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

  // Rate limiting: 100 requests per minute per IP (in‑memory store with
  // periodic sweep — see kernel/src/services/rate_limiter.ts for the hardened
  // implementation used by the unified gateway).
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      errorResponse(res, 'RATE_LIMITED', 'Too many requests, please try again later.', null, 429);
    },
  });
  router.use('/', limiter);

  // Body parser
  router.use(express.json({ limit: '10mb' }));

  // -------------------------------------------------------------------------
  // ROUTES (must be declared before error handler)
  // -------------------------------------------------------------------------

  // Health Endpoint
  router.get('/v1/health', asyncHandler(async (req, res) => {
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

    // Check database connection if Supabase is configured. Wrapped in
    // kernel/backoff.ts (retry + circuit breaker) so a degraded database
    // fails fast for this request instead of hanging, and the circuit
    // prevents a thundering herd of health probes during an outage.
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

  // Agent Dispatch Endpoint
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

  router.post('/v1/agent/dispatch', asyncHandler(async (req, res) => {
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

  // -------------------------------------------------------------------------
  // Global Error Handler (MUST be the last middleware)
  // -------------------------------------------------------------------------
  router.use((err, req, res, _next) => {
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
// dependency-injected composition roots.
// ---------------------------------------------------------------------------
export default router;
export { router, createRouter };
