#!/bin/bash
fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"
node klyn_server.js > klyn.log 2>&1 &
sleep 1
echo "=== TESTING SELF-HEALING TDD LOOP (INITIAL CODE WILL FAIL TEST) ==="
curl -X POST http://localhost:7860/v1/task -H "Content-Type: application/json" -d '{
  "instruction": "Fix mod_a status to v3.0_auto_healed",
  "file": "mod_a.js",
  "code": "module.exports = { status: \"wrong_initial_value\" };",
  "testCmd": "node -e \"const m = require(\\\"./mod_a.js\\\"); if(m.status !== \\\"v3.0_auto_healed\\\") process.exit(1);\""
}'
echo ""
