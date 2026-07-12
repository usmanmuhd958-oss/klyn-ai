const http = require('http');
const { exec } = require('child_process');
const port = 7070;

http.createServer((req, res) => {
  exec('node scripts/health_check.js', (err, stdout) => {
    const status = err ? 'unhealthy' : 'healthy';
    const html = `<!DOCTYPE html><html><head><title>Klyn OS Status</title><meta property="og:title" content="Klyn AI OS Status"><meta property="og:description" content="Current status: ${status}"><style>body{background:#0a0a1a;color:${status==='healthy'?'#0f0':'#f00'};font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;font-size:2rem}</style></head><body>${status==='healthy'?'✅ Klyn AI OS is running':'❌ Klyn AI OS is down'}</body></html>`;
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html);
  });
}).listen(port, () => console.log('Public status on port', port));
