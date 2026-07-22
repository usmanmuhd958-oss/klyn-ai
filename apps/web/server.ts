const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        const html = `<!DOCTYPE html><html><head><title>Klyn OS</title><style>body{background:#0f0f23;color:#0f0;font-family:monospace;padding:2rem}h1{color:#0f0}</style></head><body><h1>👑 Klyn AI OS v14</h1><div id="status">Checking...</div><script>fetch('/api/health').then(r=>r.json()).then(d=>document.getElementById('status').innerHTML='Status: '+d.status)</script></body></html>`;
        (res as any).writeHead(200, { 'Content-Type': 'text/html' });
        (res as any).end(html);
    } else if (req.url === '/api/health') {
        exec('node ../../scripts/health_check.js', (err, stdout) => {
            (res as any).writeHead(200, { 'Content-Type': 'application/json' });
            (res as any).end(JSON.stringify({ status: err ? 'unhealthy' : 'healthy' }));
        });
    } else {
        (res as any).writeHead(404);
        (res as any).end();
    }
});
server.listen(4000, () => console.log('Dashboard on port 4000'));


export {};
