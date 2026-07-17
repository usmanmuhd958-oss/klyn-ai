'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const Ajv = require('ajv');
const os = require('os');

// Optional Supabase client (gracefully falls back if not configured)
let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
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
  return res.status(statusCode).json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}

function errorResponse(res, code, message, details = null, statusCode = 400) {
  return res.status(statusCode).json({
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
// Express Router (no standalone app, no .listen())
// ---------------------------------------------------------------------------
const router = express.Router();

// Security middlewares
router.use(helmet());
router.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// Rate limiting: 100 requests per minute per IP (in‑memory store)
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

// ---------------------------------------------------------------------------
// ROUTES (must be declared before error handler)
// ---------------------------------------------------------------------------

// Health Endpoint
router.get('/v1/health', asyncHandler(async (req, res) => {
  const mem = process.memoryUsage();
  const healthData = {
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

  // Check database connection if Supabase is configured
  if (supabase) {
    try {
      await supabase.from('organizations').select('id', { head: true, count: 'exact' }).limit(1);
      healthData.dbStatus = 'connected';
    } catch (dbErr) {
      logger.warn({ err: dbErr }, 'Database health check failed');
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

  logger.info({ dispatch: dispatchResult }, 'Agent dispatched');
  successResponse(res, dispatchResult, 202);
}));

// ---------------------------------------------------------------------------
// Global Error Handler (MUST be the last middleware)
// ---------------------------------------------------------------------------
router.use((err, req, res, _next) => {
  logger.error({ err }, 'Unhandled error in API router');
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Internal server error';
  const details = process.env.NODE_ENV === 'development' ? err.stack : undefined;
  return errorResponse(res, code, message, details, statusCode);
});

// ---------------------------------------------------------------------------
// Export the router to be mounted by the main app
// ---------------------------------------------------------------------------
module.exports = router;
