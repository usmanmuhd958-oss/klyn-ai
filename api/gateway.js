const http = require('http');
const port = 8000;
http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({gateway:"Klyn AI OS", status:"online"}));
}).listen(port, () => console.log('Gateway on port', port));
