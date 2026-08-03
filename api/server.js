/**
 * =============================================================================
 * KLYN AI OS — Secure API Server
 * File: api/server.js
 * Version: 2.0.0 (ESM)
 * =============================================================================
 *
 * PURPOSE:
 *   HTTP API exposing authenticated agent execution, RBAC user management
 *   and hash-chained audit verification. Replaces the previous
 *   api/server.ts, which referenced nonexistent .js kernel modules and the
 *   undeclared `jsonwebtoken` dependency.
 *
 * DEPENDENCIES (all local/builtin, no external installs required):
 *   - kernel/src/auth/jose.js            (HS256 JWT + RBAC)
 *   - kernel/src/services/logger.js      (hash-chained audit log)
 *   - kernel/src/execution/agent_executor.js
 *
 * ENV:
 *   JWT_SECRET      (required)  Secret used to sign/verify JWTs.
 *   ADMIN_PASSWORD  (required)  Password for the admin account.
 *   PORT            (optional)  Default 3000.
 * =============================================================================
 */

'use strict';

import http from 'node:http';
import { parse } from 'node:url';
import crypto from 'node:crypto';

import { sign, verify, initRBAC, hasPermission, addUser } from '../kernel/src/auth/jose.js';
import { logEvent, initAudit, verifyChain, getRecentEvents } from '../kernel/src/services/logger.js';
import { getAgentExecutor } from '../kernel/src/execution/agent_executor.js';

// Fail-fast on missing secrets
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!JWT_SECRET || !ADMIN_PASSWORD) {
  console.error('❌ FATAL: JWT_SECRET or ADMIN_PASSWORD not set');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const agentExecutor = getAgentExecutor();

function logRequest(req, action, user = 'anonymous', details = {}) {
  logEvent(action, user, {
    method: req.method,
    path: req.url,
    ...details,
  }).catch((err) => console.error('[Audit] Log error:', err));
}

function authenticate(req) {
  const auth = req.headers.authorization || '';
  const token = auth.split(' ')[1];
  if (!token) return null;
  try {
    return verify(token, JWT_SECRET);
  } catch (_) {
    return null;
  }
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      if (body.length > maxBytes) return;
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = parse(req.url, true);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const json = (statusCode, payload) => {
    res.writeHead(statusCode);
    res.end(JSON.stringify(payload));
  };

  // Health check (no auth required)
  if (parsed.pathname === '/status' && req.method === 'GET') {
    json(200, { status: 'healthy', timestamp: new Date().toISOString() });
    return;
  }

  // Login endpoint
  if (parsed.pathname === '/auth/login' && req.method === 'POST') {
    const body = await readBody(req, 10 * 1024);
    try {
      const { username, password } = JSON.parse(body || '{}');

      // Constant-time comparison to prevent timing attacks
      const pwMatch = crypto.timingSafeEqual(
        Buffer.from(password || ''),
        Buffer.from(ADMIN_PASSWORD)
      );
      const userMatch = username === 'admin';

      if (userMatch && pwMatch) {
        const token = sign({ username }, JWT_SECRET, { expiresIn: '24h' });
        logRequest(req, 'auth:login_success', username);
        json(200, { token });
      } else {
        logRequest(req, 'auth:login_failure', username || 'unknown');
        json(403, { error: 'Invalid credentials' });
      }
    } catch (err) {
      console.error('[API] Login parse error:', err);
      json(400, { error: 'Invalid request' });
    }
    return;
  }

  // Secure agent execution endpoint
  if (parsed.pathname === '/agent/run' && req.method === 'POST') {
    const user = authenticate(req);
    if (!user) {
      json(401, { error: 'Unauthorized' });
      return;
    }

    try {
      const granted = await hasPermission(user.username, 'agent:run');
      if (!granted) {
        logRequest(req, 'agent:run_denied', user.username, { reason: 'no_permission' });
        json(403, { error: 'Forbidden – insufficient permissions' });
        return;
      }

      const body = await readBody(req, 50 * 1024);
      const { agent, task } = JSON.parse(body || '{}');

      if (!agent || typeof agent !== 'string') throw new Error('Invalid agent parameter');
      if (!task || typeof task !== 'string') throw new Error('Invalid task parameter');

      const result = await agentExecutor.executeAgent(agent, task, 30_000);

      logRequest(req, 'agent:run_executed', user.username, {
        agent,
        success: result.success,
        duration: result.duration,
        error: result.error,
      });

      json(result.success ? 200 : 500, result);
    } catch (err) {
      console.error('[API] /agent/run error:', err);
      logRequest(req, 'agent:run_error', user.username, { error: err.message });
      json(400, { error: err.message });
    }
    return;
  }

  // Admin: add user
  if (parsed.pathname === '/admin/users' && req.method === 'POST') {
    const user = authenticate(req);
    if (!user) {
      json(401, { error: 'Unauthorized' });
      return;
    }

    try {
      const granted = await hasPermission(user.username, 'admin:users');
      if (!granted) {
        logRequest(req, 'admin:add_user_denied', user.username);
        json(403, { error: 'Forbidden' });
        return;
      }

      const body = await readBody(req, 10 * 1024);
      const { username, role } = JSON.parse(body || '{}');
      if (!username || !role) throw new Error('Missing username or role');

      await addUser(username, role);
      logRequest(req, 'admin:add_user_success', user.username, { newUser: username, role });
      json(200, { success: true });
    } catch (err) {
      console.error('[API] admin:add_user error:', err);
      json(400, { error: err.message });
    }
    return;
  }

  // Audit verification endpoint
  if (parsed.pathname === '/audit/verify' && req.method === 'GET') {
    const user = authenticate(req);
    if (!user) {
      json(401, { error: 'Unauthorized' });
      return;
    }

    try {
      const valid = await verifyChain();
      json(200, { valid });
    } catch (err) {
      console.error('[API] audit:verify error:', err);
      json(500, { error: 'Internal error' });
    }
    return;
  }

  // Get recent audit events
  if (parsed.pathname === '/audit/recent' && req.method === 'GET') {
    const user = authenticate(req);
    if (!user) {
      json(401, { error: 'Unauthorized' });
      return;
    }

    try {
      const events = await getRecentEvents(50);
      json(200, events);
    } catch (err) {
      console.error('[API] audit:recent error:', err);
      json(500, { error: 'Internal error' });
    }
    return;
  }

  json(404, { error: 'Not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => process.exit(0));
});

initRBAC()
  .then(() => initAudit())
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Secure API listening on port ${PORT}`);
      console.log('🔒 RBAC enabled | Audit logging active | Agent executor hardened');
    });
  })
  .catch((err) => {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  });
