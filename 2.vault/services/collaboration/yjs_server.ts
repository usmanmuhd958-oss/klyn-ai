// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const WebSocket = require('ws');
const http = require('http');
const Y = require('yjs');
const { setupWSConnection } = require('y-websocket/bin/utils');

const PORT = 1234;
const server = http.createServer((req, res) => {
    (res as any).writeHead(200);
    (res as any).end('Klyn Collaborative Editing Server');
});
const wss = new WebSocket.Server({ server });

wss.on('connection', setupWSConnection);
server.listen(PORT, () => console.log('Collaborative editing server on port', PORT));


export {};
