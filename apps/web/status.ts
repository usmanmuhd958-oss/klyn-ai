const http = require('http');
const { exec } = require('child_process');
const port = 5050;

function getServiceStatus(name, pattern, callback) {
  exec(`pgrep -f "${pattern}" >/dev/null && echo running || echo dead`, (err, stdout) => {
    callback(stdout.trim());
  });
}

http.createServer((req, res) => {
  if (req.url === '/api/status') {
    let status = { timestamp: new Date().toISOString(), services: {} };
    let checks = [
      { name: 'API Server', pattern: 'node api/server.js' },
      { name: 'Metrics', pattern: 'node api/metrics.js' },
      { name: 'Admin Dashboard', pattern: 'apps/web/admin.js' },
      { name: 'Web Editor', pattern: 'dashboard/web_editor.js' },
      { name: 'Gateway', pattern: 'api/gateway.js' },
      { name: 'Collaboration', pattern: 'collaboration/server.js' },
      { name: 'DeepSeek Model', pattern: 'llama.cpp' },
    ];
    let done = 0;
    checks.forEach(c => {
      getServiceStatus(c.name, c.pattern, (statusStr) => {
        (status as any).services[c.name] = statusStr;
        done++;
        if (done === checks.length) {
          (res as any).writeHead(200, {'Content-Type': 'application/json'});
          (res as any).end(JSON.stringify(status, null, 2));
        }
      });
    });
  } else {
    const html = `<!DOCTYPE html><html><head><title>Klyn System Status</title><style>body{background:#0a0a1a;color:#0f0;font-family:monospace;padding:2rem}h1{color:#0f0} .running{color:#0f0} .dead{color:#f00}</style></head><body><h1>🖥️ Klyn AI OS System Status</h1><div id="status"></div><script>fetch('/api/status').then(r=>r.json()).then(d=>{let html='';for(let s in d.services){html+=s+': <span class="'+d.services[s]+'">'+d.services[s]+'</span><br>';}document.getElementById('status').innerHTML=html;})</script></body></html>`;
    (res as any).writeHead(200, {'Content-Type': 'text/html'});
    (res as any).end(html);
  }
}).listen(port, () => console.log('Status page on port', port));


export {};
