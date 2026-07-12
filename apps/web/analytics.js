const http = require('http');
const { exec } = require('child_process');
const port = 6060;

http.createServer((req, res) => {
  if (req.url === '/') {
    const html = `<!DOCTYPE html><html><head><title>Klyn Analytics</title>
<style>body{background:#0a0a1a;color:#0f0;font-family:monospace;padding:2rem}h1{color:#0f0}
.card{background:#111;padding:1rem;margin:1rem 0;border-radius:8px}
table{width:100%;border-collapse:collapse} th,td{padding:8px;text-align:left;border-bottom:1px solid #333}
</style></head><body><h1>📊 Klyn AI OS Performance Analytics</h1>
<div class="card"><h3>Model Performance</h3><table id="stats"><tr><th>Model</th><th>Calls</th><th>Success Rate</th><th>Avg Response</th><th>Last Used</th></tr></table></div>
<div class="card"><h3>Best Model Right Now</h3><div id="best"></div></div>
<script>
fetch('/api/stats').then(r=>r.json()).then(d=>{
  let rows=''; d.forEach(m=>{ rows+=`<tr><td>${m.model}</td><td>${m.total_calls}</td><td>${(m.success_calls/m.total_calls*100).toFixed(1)}%</td><td>${Math.round(m.avg_response_ms)}ms</td><td>${m.last_used||'never'}</td></tr>`; });
  document.getElementById('stats').innerHTML+='<tbody>'+rows+'</tbody>';
});
fetch('/api/best').then(r=>r.text()).then(d=>{ document.getElementById('best').innerText='🏆 '+d; });
</script></body></html>`;
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html);
  } else if (req.url === '/api/stats') {
    exec('node kernel/src/services/agent_memory.js stats', (err, stdout) => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(stdout || '[]');
    });
  } else if (req.url === '/api/best') {
    exec('node kernel/src/services/agent_memory.js best', (err, stdout) => {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end(stdout || 'local');
    });
  } else {
    res.writeHead(404); res.end();
  }
}).listen(port, () => console.log('Analytics on port', port));
