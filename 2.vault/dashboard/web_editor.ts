// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');

const PORT = 8081;
const projectsDir = path.join(__dirname, '..', 'projects');

// Yjs document for real‑time collaboration (shared across clients)
const ydoc = new Y.Doc();
const ytext = ydoc.getText('codemirror'); // we'll use a simple text area first

http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = (parsed as any).pathname;

    // WebSocket upgrade for Yjs
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        return; // handled by y-websocket later if we attach, but for simplicity we serve the collab via same port later
    }

    if (pathname === '/' || pathname === '/index.html') {
        const projects = fs.readdirSync(projectsDir).filter(d => d !== 'templates');
        let html = `<!DOCTYPE html><html><head><title>Klyn Collaborative IDE</title>
<style>body{background:#0a0a1a;color:#0f0;font-family:monospace;padding:2rem}h1{color:#0f0}
.card{background:#111;padding:1rem;margin:1rem 0;border-radius:8px}
textarea{width:100%;height:300px;background:#000;color:#0f0;border:1px solid #333;font-family:monospace;padding:0.5rem}
#cursors{color:#ff0;margin-bottom:0.5rem}
</style></head><body>
<h1>🌐 Klyn AI OS Collaborative IDE</h1>
<div class="card"><h3>Projects</h3><ul>`;
        projects.forEach(p => { html += `<li><a href="/project/${p}">${p}</a></li>`; });
        html += `</ul></div>
<div class="card"><h3>Shared Editor (Real‑time)</h3>
<div id="cursors"></div>
<textarea id="editor"></textarea>
</div>
<script src="/yjs.bundle.js"></script>
<script>
// Connect to the Yjs WebSocket server (port 1234)
const ydoc = new Y.Doc();
const provider = new Y.WebsocketProvider('ws://localhost:1234', 'klyn-room', ydoc);
const yText = ydoc.getText('codemirror');
const editor = document.getElementById('editor');

// Sync from Yjs to textarea
yText.observe(event => {
    editor.value = yText.toString();
});

// Sync from textarea to Yjs
editor.addEventListener('input', () => {
    yText.delete(0, yText.length);
    yText.insert(0, editor.value);
});

// Show awareness (cursors) – simplified
const awareness = provider.awareness;
awareness.on('change', () => {
    let cursors = '';
    awareness.getStates().forEach((state, clientId) => {
        if (state.user) cursors += '👤 ' + state.user.name + ' ';
    });
    document.getElementById('cursors').innerText = cursors || 'No other users';
});
awareness.setLocalState({ user: { name: 'You' } });
</script></body></html>`;
        (res as any).writeHead(200, {'Content-Type': 'text/html'});
        (res as any).end(html);
    } else if (pathname === '/yjs.bundle.js') {
        // Serve Yjs bundle (simplified – in production use a bundler)
        (res as any).writeHead(200, {'Content-Type': 'application/javascript'});
        (res as any).end(`
// Minimal Yjs bundle placeholder – use actual yjs package in production
import('yjs').then(m => window.Y = m);
import('y-websocket').then(m => window.Y.WebsocketProvider = m.WebsocketProvider);
`);
    } else if (pathname.startsWith('/project/')) {
        const parts = pathname.split('/');
        const project = parts[2];
        const filePath = parts.slice(3).join('/');
        const fullPath = path.join(projectsDir, project, filePath);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            (res as any).writeHead(200, {'Content-Type': 'text/plain'});
            (res as any).end(fs.readFileSync(fullPath, 'utf8'));
        } else {
            // List project files
            const dirPath = path.join(projectsDir, project);
            if (fs.existsSync(dirPath)) {
                const files = fs.readdirSync(dirPath);
                let listHtml = `<h2>${project}</h2><ul>`;
                files.forEach(f => { listHtml += `<li><a href="/project/${project}/${f}">${f}</a></li>`; });
                listHtml += '</ul><a href="/">Back</a>';
                (res as any).writeHead(200, {'Content-Type': 'text/html'});
                (res as any).end(listHtml);
            } else {
                (res as any).writeHead(404);
                (res as any).end('Project not found');
            }
        }
    } else {
        (res as any).writeHead(404);
        (res as any).end('Not found');
    }
}).listen(PORT, () => console.log('Collaborative Web IDE on port', PORT));


export {};
