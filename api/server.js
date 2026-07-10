const http = require('http');
const url = require('url');
let jwt;
try { jwt = require('jsonwebtoken'); } catch(e) {}
const SECRET = process.env.JWT_SECRET || 'klyn-royal-secret';
const PORT = process.env.PORT || 3000;

// Load RBAC and Audit (optional – graceful fallback if not present)
let rbac, audit;
try { rbac = require('../kernel/src/auth/rbac.js'); rbac.initRBAC(); } catch(e) {}
try { audit = require('../kernel/src/services/audit_logger.js'); } catch(e) {}

function authenticate(req) {
  const auth = req.headers.authorization;
  if (!auth) return false;
  const token = auth.split(' ')[1];
  try { return jwt.verify(token, SECRET); } catch(e) { return false; }
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // Health endpoint (no auth)
  if (parsed.pathname === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy' }));
    return;
  }

  // Login endpoint (no auth)
  if (parsed.pathname === '/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { username, password } = JSON.parse(body || '{}');
      if (username === 'admin' && password === (process.env.ADMIN_PASSWORD || 'klyn')) {
        const token = jwt.sign({ username }, SECRET, { expiresIn: '24h' });
        if (audit) audit.logEvent('login', username, { success: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token }));
      } else {
        if (audit) audit.logEvent('login', username || 'unknown', { success: false });
        res.writeHead(403);
        res.end('Forbidden');
      }
    });
    return;
  }

  // Agent run (auth + RBAC required)
  if (parsed.pathname === '/agent/run' && req.method === 'POST') {
    const user = authenticate(req);
    if (!user) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }
    if (rbac && !rbac.hasPermission(user.username, 'agent:run')) {
      if (audit) audit.logEvent('agent:run', user.username, { denied: true });
      res.writeHead(403);
      res.end('Forbidden – insufficient permissions');
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { agent, task } = JSON.parse(body || '{}');
      const { exec } = require('child_process');
      exec(`bash agents/src/${agent}.sh "${task}"`, (err, stdout) => {
        if (audit) audit.logEvent('agent:run', user.username, { agent, task, success: !err });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: stdout }));
      });
    });
    return;
  }

  // Admin endpoint (auth + admin role required)
  if (parsed.pathname === '/admin/users' && req.method === 'POST') {
    const user = authenticate(req);
    if (!user) { res.writeHead(401); res.end('Unauthorized'); return; }
    if (rbac && !rbac.hasPermission(user.username, 'admin:users')) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { username, role } = JSON.parse(body || '{}');
      if (rbac) rbac.addUser(username, role);
      if (audit) audit.logEvent('admin:add_user', user.username, { newUser: username, role });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});
server.listen(PORT, () => console.log(`API secured with RBAC on port ${PORT}`));
