const http = require('http');
const fs = require('fs');
const path = require('path');
const projectsDir = path.join(__dirname, '..', 'projects');
const port = 8081;

http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    let projects = [];
    try { projects = fs.readdirSync(projectsDir).filter(d => d !== 'templates'); } catch(e) {}
    const projectList = projects.map(p => `<li>${p}</li>`).join('');
    const html = `<!DOCTYPE html><html><head><title>Klyn Web Editor</title><style>body{background:#0a0a1a;color:#0f0;font-family:monospace;padding:2rem}h1{color:#0f0}</style></head><body><h1>🌐 Klyn AI OS Web Editor</h1><div class="card"><h3>Projects</h3><ul>${projectList || '<li>No projects yet</li>'}</ul></div></body></html>`;
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html);
  } else {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not found');
  }
}).listen(port, '0.0.0.0', () => console.log('Web Editor on port', port));
