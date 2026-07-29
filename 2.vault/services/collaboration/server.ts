// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9000;
const server = http.createServer((req, res) => {
  (res as any).writeHead(200);
  (res as any).end('Klyn Collaboration Server');
});
const wss = new WebSocket.Server({ server });

const projectsDir = path.join(__dirname, '..', '..', 'projects');

wss.on('connection', (ws) => {
  console.log('New collaborator connected');
  
  ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    // Broadcast changes to all other clients
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
    // Persist changes if a file save event
    if ((data as any).type === 'save') {
      const filePath = path.join(projectsDir, (data as any).project, (data as any).file);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, (data as any).content);
      console.log(`Saved: ${filePath}`);
    }
  });
});

server.listen(PORT, () => console.log('Collaboration server on port', PORT));


export {};
