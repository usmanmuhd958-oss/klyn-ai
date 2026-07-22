const http = require('http');
const PORT = 9090;
const server = http.createServer((req, res) => {
  if (req.url === '/metrics') {
    // Simple example metrics
    const os = require('os');
    let metrics = '# HELP klyn_os_info Klyn OS metrics\n';
    metrics += '# TYPE klyn_os_info gauge\n';
    metrics += `klyn_os_info{version="v15"} 1\n`;
    metrics += `klyn_uptime_seconds ${process.uptime()}\n`;
    (res as any).writeHead(200, { 'Content-Type': 'text/plain' });
    (res as any).end(metrics);
  } else {
    (res as any).writeHead(404);
    (res as any).end();
  }
});
server.listen(PORT, () => console.log(`Metrics on port ${PORT}`));


export {};
