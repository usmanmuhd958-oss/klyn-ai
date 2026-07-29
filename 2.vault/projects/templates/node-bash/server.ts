// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const http = require('http');
const server = http.createServer((req, res) => {
    (res as any).writeHead(200, {'Content-Type': 'text/plain'});
    (res as any).end('Klyn AI OS Node.js Project\n');
});
server.listen(3000, () => console.log('Running on port 3000'));


export {};
