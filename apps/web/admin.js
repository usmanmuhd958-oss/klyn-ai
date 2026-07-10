const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 5000;
const PROJECT_ROOT = '/data/data/com.termux/files/home/klyn-ai-os';

function getHealth(callback) {
  exec(`node ${PROJECT_ROOT}/scripts/health_check.js`, (err, stdout) => {
    callback(err ? 'unhealthy' : 'healthy');
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html><head><title>Klyn Admin</title>
<style>body{background:#0a0a1a;color:#e0e0e0;font-family:monospace;padding:2rem}
h1{color:#0f0} .card{background:#111;padding:1rem;margin:1rem 0;border-radius:8px}
.denied{color:#f00} .granted{color:#0f0}
</style></head>
<body>
<h1>🏛️ Klyn AI OS Enterprise Admin</h1>
<div class="card"><h3>Health</h3><div id="health">Checking...</div></div>
<div class="card"><h3>RBAC Check</h3>
<input id="user" placeholder="username" value="admin">
<input id="action" placeholder="action" value="agent:run">
<button onclick="checkRBAC()">Check Permission</button>
<div id="rbacResult"></div></div>
<div class="card"><h3>Audit Trail</h3><pre id="audit"></pre></div>
<div class="card"><h3>Verify Audit Chain</h3>
<button onclick="verifyAudit()">Verify Integrity</button>
<div id="verifyResult"></div></div>
<script>
fetch('/api/health').then(r=>r.json()).then(d=>document.getElementById('health').innerText='Status: '+d.status);
function checkRBAC(){
  const u=document.getElementById('user').value;
  const a=document.getElementById('action').value;
  fetch('/api/rbac/check?user='+u+'&action='+a).then(r=>r.json()).then(d=>{
    document.getElementById('rbacResult').innerHTML = d.granted ? '<span class="granted">GRANTED</span>' : '<span class="denied">DENIED</span>';
  });
}
function verifyAudit(){
  fetch('/api/audit/verify').then(r=>r.json()).then(d=>{
    document.getElementById('verifyResult').innerText = d.valid ? '✅ Audit chain VALID' : '❌ TAMPERED!';
  });
}
fetch('/api/audit/recent').then(r=>r.json()).then(d=>document.getElementById('audit').innerText=JSON.stringify(d,null,2));
</script></body></html>`);
  } else if (req.url === '/api/health') {
    getHealth(status => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status }));
    });
  } else if (req.url.startsWith('/api/rbac/check')) {
    const urlParams = new URL(req.url, 'http://localhost');
    const user = urlParams.searchParams.get('user');
    const action = urlParams.searchParams.get('action');
    const rbac = require('./kernel/src/auth/rbac.js');
    rbac.initRBAC();
    const granted = rbac.hasPermission(user, action);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user, action, granted }));
  } else if (req.url === '/api/audit/recent') {
    try {
      const chain = fs.readFileSync(path.join(PROJECT_ROOT, 'runtime', 'audit_logs', 'chain.jsonl'), 'utf8');
      const lines = chain.trim().split('\n').filter(Boolean);
      const recent = lines.slice(-50).map(l => JSON.parse(l));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recent));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
  } else if (req.url === '/api/audit/verify') {
    const audit = require('./kernel/src/services/audit_logger.js');
    const valid = audit.verifyChain();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ valid }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Enterprise Admin Dashboard on port ${PORT}`));
