const WebSocket = require('ws');
const http = require('http');
const Y = require('yjs');
const { setupWSConnection } = require('y-websocket/bin/utils');

const PORT = 1234;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Klyn Collaborative Editing Server');
});
const wss = new WebSocket.Server({ server });

wss.on('connection', setupWSConnection);
server.listen(PORT, () => console.log('Collaborative editing server on port', PORT));
