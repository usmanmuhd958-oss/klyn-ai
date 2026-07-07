const http = require('http');
const url = require('url');
let jwt;
try { jwt = require('jsonwebtoken'); } catch(e) {}
const SECRET = process.env.JWT_SECRET || '***REMOVED***';
const PORT = process.env.PORT || 3000;

function authenticate(req) {
  const auth = req.headers.authorization;
  if (!auth) return false;
  const token = auth.split(' ')[1];
  try { return jwt.verify(token, SECRET); } catch(e) { return false; }
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy' }));
  } else if (parsed.pathname === '/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { username, password } = JSON.parse(body || '{}');
      if (username === 'admin' && password === (process.env.ADMIN_PASSWORD || 'klyn')) {
        const token = jwt.sign({ username }, SECRET, { expiresIn: '24h' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token }));
      } else {
        res.writeHead(403);
        res.end('Forbidden');
      }
    });
  } else if (parsed.pathname === '/agent/run' && req.method === 'POST') {
    if (!authenticate(req)) { res.writeHead(401); return res.end('Unauthorized'); }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { agent, task } = JSON.parse(body || '{}');
      const { exec } = require('child_process');
      exec(`bash agents/src/${agent}.sh "${task}"`, (err, stdout) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: stdout }));
      });
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(PORT, () => console.log(`API secured on port ${PORT}`));
