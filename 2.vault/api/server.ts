// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const http = require('http');
const url = require('url');
const crypto = require('crypto');

let jwt;
try { jwt = require('jsonwebtoken'); } catch (e) {
  console.error('❌ jsonwebtoken not installed. Run: npm install jsonwebtoken');
  process.exit(1);
}

const rbac = require('../kernel/src/auth/rbac.js');
const audit = require('../kernel/src/services/audit_logger.js');
const agentExecutor = require('../kernel/src/execution/agent_executor.js');

// Fail-fast on missing secrets
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!JWT_SECRET || !ADMIN_PASSWORD) {
  console.error('❌ FATAL: JWT_SECRET or ADMIN_PASSWORD not set');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

// Request logging middleware
function logRequest(req, action, user = 'anonymous', details = {}) {
  audit.logEvent(action, user, {
    method: req.method,
    path: req.url,
    ...details
  }).catch(err => console.error('[Audit] Log error:', err));
}

function authenticate(req) {
  const auth = req.headers.authorization || '';
  const token = auth.split(' ')[1];
  if (!token) return null;
  
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  (res as any).setHeader('Content-Type', 'application/json');
  (res as any).setHeader('X-Content-Type-Options', 'nosniff');

  // Health check (no auth required)
  if ((parsed as any).pathname === '/status' && req.method === 'GET') {
    (res as any).writeHead(200);
    (res as any).end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
    return;
  }

  // Login endpoint
  if ((parsed as any).pathname === '/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      if (body.length > 10 * 1024) return; // Prevent large payloads
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body || '{}');
        
        // Constant-time comparison to prevent timing attacks
        const pwMatch = crypto.timingSafeEqual(
          Buffer.from(password || ''),
          Buffer.from(ADMIN_PASSWORD)
        );
        const userMatch = username === 'admin';

        if (userMatch && pwMatch) {
          const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
          logRequest(req, 'auth:login_success', username);
          (res as any).writeHead(200);
          (res as any).end(JSON.stringify({ token }));
        } else {
          logRequest(req, 'auth:login_failure', username || 'unknown');
          (res as any).writeHead(403);
          (res as any).end(JSON.stringify({ error: 'Invalid credentials' }));
        }
      } catch (err) {
        console.error('[API] Login parse error:', err);
        (res as any).writeHead(400);
        (res as any).end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // Secure agent execution endpoint
  if ((parsed as any).pathname === '/agent/run' && req.method === 'POST') {
    const user = authenticate(req);
    if (!user) {
      (res as any).writeHead(401);
      (res as any).end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Check RBAC permission
    rbac.hasPermission(user.username, 'agent:run').then(granted => {
      if (!granted) {
        logRequest(req, 'agent:run_denied', user.username, { reason: 'no_permission' });
        (res as any).writeHead(403);
        (res as any).end(JSON.stringify({ error: 'Forbidden – insufficient permissions' }));
        return;
      }

      let body = '';
      req.on('data', chunk => {
        if (body.length > 50 * 1024) return; // Prevent large payloads
        body += chunk;
      });

      req.on('end', async () => {
        try {
          const { agent, task } = JSON.parse(body || '{}');
          
          if (!agent || typeof agent !== 'string') {
            throw new Error('Invalid agent parameter');
          }
          if (!task || typeof task !== 'string') {
            throw new Error('Invalid task parameter');
          }

          // Execute with secure spawn
          const result = await agentExecutor.executeAgent(agent, task, 30000);
          
          logRequest(req, 'agent:run_executed', user.username, {
            agent,
            success: result.success,
            duration: result.duration,
            error: result.error
          });

          (res as any).writeHead(result.success ? 200 : 500);
          (res as any).end(JSON.stringify(result));
        } catch (err) {
          console.error('[API] /agent/run error:', err);
          logRequest(req, 'agent:run_error', user.username, { error: err.message });
          (res as any).writeHead(400);
          (res as any).end(JSON.stringify({ error: err.message }));
        }
      });
    }).catch(err => {
      console.error('[API] RBAC check error:', err);
      (res as any).writeHead(500);
      (res as any).end(JSON.stringify({ error: 'Internal server error' }));
    });
    return;
  }

  // Admin: add user
  if ((parsed as any).pathname === '/admin/users' && req.method === 'POST') {
    const user = authenticate(req);
    if (!user) {
      (res as any).writeHead(401);
      (res as any).end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    rbac.hasPermission(user.username, 'admin:users').then(granted => {
      if (!granted) {
        logRequest(req, 'admin:add_user_denied', user.username);
        (res as any).writeHead(403);
        (res as any).end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { username, role } = JSON.parse(body || '{}');
          if (!username || !role) throw new Error('Missing username or role');
          
          await rbac.addUser(username, role);
          logRequest(req, 'admin:add_user_success', user.username, { newUser: username, role });
          (res as any).writeHead(200);
          (res as any).end(JSON.stringify({ success: true }));
        } catch (err) {
          console.error('[API] admin:add_user error:', err);
          (res as any).writeHead(400);
          (res as any).end(JSON.stringify({ error: err.message }));
        }
      });
    }).catch(err => {
      console.error('[API] RBAC check error:', err);
      (res as any).writeHead(500);
      (res as any).end(JSON.stringify({ error: 'Internal server error' }));
    });
    return;
  }

  // Audit verification endpoint
  if ((parsed as any).pathname === '/audit/verify' && req.method === 'GET') {
    const user = authenticate(req);
    if (!user) {
      (res as any).writeHead(401);
      (res as any).end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    audit.verifyChain().then(valid => {
      (res as any).writeHead(200);
      (res as any).end(JSON.stringify({ valid }));
    }).catch(err => {
      console.error('[API] audit:verify error:', err);
      (res as any).writeHead(500);
      (res as any).end(JSON.stringify({ error: 'Internal error' }));
    });
    return;
  }

  // Get recent audit events
  if ((parsed as any).pathname === '/audit/recent' && req.method === 'GET') {
    const user = authenticate(req);
    if (!user) {
      (res as any).writeHead(401);
      (res as any).end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    audit.getRecentEvents(50).then(events => {
      (res as any).writeHead(200);
      (res as any).end(JSON.stringify(events));
    }).catch(err => {
      console.error('[API] audit:recent error:', err);
      (res as any).writeHead(500);
      (res as any).end(JSON.stringify({ error: 'Internal error' }));
    });
    return;
  }

  (res as any).writeHead(404);
  (res as any).end(JSON.stringify({ error: 'Not found' }));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => process.exit(0));
});

rbac.initRBAC()
  .then(() => audit.initAudit())
  .then(() => {
    server.listen(PORT, () => {
      console.log(`✅ Secure API listening on port ${PORT}`);
      console.log(`🔒 RBAC enabled | Audit logging active | Agent executor hardened`);
    });
  })
  .catch(err => {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  });


export {};
