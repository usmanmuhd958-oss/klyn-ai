import http from 'node:http';

const port = 8000;
http.createServer((req, res) => {
    (res as any).writeHead(200, { 'Content-Type': 'application/json' });
    (res as any).end(JSON.stringify({ gateway: "Klyn AI OS", status: "online" }));
}).listen(port, () => console.log('Gateway on port', port));


export {};
