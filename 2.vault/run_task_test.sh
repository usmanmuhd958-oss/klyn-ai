#!/bin/bash
fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"
node klyn_server.js > klyn.log 2>&1 &
sleep 1
echo "=== TESTING AUTONOMOUS TASK WITH TEST VERIFICATION ==="
curl -X POST http://localhost:7860/v1/task -H "Content-Type: application/json" -d '{
  "instruction": "Upgrade mod_a to version 2.9 with verified exports",
  "file": "mod_a.js",
  "code": "module.exports = { status: \"v2.9_verified\" };",
  "testCmd": "node -e \"const m = require(\\\"./mod_a.js\\\"); if(m.status !== \\\"v2.9_verified\\\") process.exit(1);\""
}'
echo ""
