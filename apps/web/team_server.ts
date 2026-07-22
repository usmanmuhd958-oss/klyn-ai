const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 7000;
const USERS_FILE = path.join(__dirname, '..', '..', 'runtime', 'team_users.json');
const TEAMS_FILE = path.join(__dirname, '..', '..', 'runtime', 'teams.json');

function initFiles() {
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}));
  if (!fs.existsSync(TEAMS_FILE)) fs.writeFileSync(TEAMS_FILE, JSON.stringify({}));
}

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

initFiles();

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    (res as any).writeHead(200, {'Content-Type': 'text/html'});
    (res as any).end(`<!DOCTYPE html><html><head><title>Klyn Team Server</title>
<style>body{background:#0a0a1a;color:#0f0;font-family:monospace;padding:2rem}h1{color:#0f0}
.card{background:#111;padding:1rem;margin:1rem 0;border-radius:8px}
input,select{background:#000;color:#0f0;border:1px solid #333;padding:0.5rem;margin:0.5rem 0;width:200px}
button{background:#0f0;color:#000;border:none;padding:0.5rem 1rem;cursor:pointer}
</style></head><body>
<h1>👥 Klyn AI OS Team Server</h1>
<div class="card"><h3>Add User</h3><input id="username" placeholder="username"><select id="role"><option>admin</option><option>developer</option><option>viewer</option></select><button onclick="addUser()">Add</button></div>
<div class="card"><h3>Users</h3><div id="users"></div></div>
<div class="card"><h3>Teams</h3><div id="teams"></div></div>
<script>
function addUser(){fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('username').value,role:document.getElementById('role').value})}).then(r=>r.json()).then(alert);}
fetch('/api/users').then(r=>r.json()).then(d=>{let h='';for(let u in d)h+=u+': '+d[u].role+'<br>';document.getElementById('users').innerHTML=h;});
fetch('/api/teams').then(r=>r.json()).then(d=>{let h='';for(let t in d)h+=t+': '+d[t].members.join(', ')+'<br>';document.getElementById('teams').innerHTML=h;});
</script></body></html>`);
  } else if (req.method === 'GET' && req.url === '/api/users') {
    (res as any).writeHead(200, {'Content-Type': 'application/json'});
    (res as any).end(fs.readFileSync(USERS_FILE));
  } else if (req.method === 'POST' && req.url === '/api/users') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { username, role } = JSON.parse(body);
      const users = readJSON(USERS_FILE);
      users[username] = { role, joined: new Date().toISOString() };
      writeJSON(USERS_FILE, users);
      (res as any).writeHead(200, {'Content-Type': 'application/json'});
      (res as any).end(JSON.stringify({ success: true }));
    });
  } else if (req.method === 'GET' && req.url === '/api/teams') {
    (res as any).writeHead(200, {'Content-Type': 'application/json'});
    (res as any).end(fs.readFileSync(TEAMS_FILE));
  } else if (req.method === 'POST' && req.url === '/api/teams') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { name, members } = JSON.parse(body);
      const teams = readJSON(TEAMS_FILE);
      teams[name] = { members, created: new Date().toISOString() };
      writeJSON(TEAMS_FILE, teams);
      (res as any).writeHead(200, {'Content-Type': 'application/json'});
      (res as any).end(JSON.stringify({ success: true }));
    });
  } else {
    (res as any).writeHead(404);
    (res as any).end('Not found');
  }
});
server.listen(PORT, () => console.log('Team server on port', PORT));


export {};
