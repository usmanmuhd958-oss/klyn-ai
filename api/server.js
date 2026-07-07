const http = require('http');
const PORT = 3000;

const server = http.createServer((req, res) => {
    if (req.url === '/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy' }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
    // Signal that the API is ready by writing a file
    const fs = require('fs');
    fs.writeFileSync('/tmp/klyn_api_ready', '1');
});

// If port is busy, log and exit
server.on('error', (e) => {
    console.error('API start error:', e.message);
    process.exit(1);
});
