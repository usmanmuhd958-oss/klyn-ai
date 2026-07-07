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
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(metrics);
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(PORT, () => console.log(`Metrics on port ${PORT}`));
