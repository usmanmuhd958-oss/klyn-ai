#!/bin/bash
fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"
node klyn_server.js > klyn.log 2>&1 &
sleep 1
echo "=== TESTING ATOMIC TRANSACTION (PASSED CODE) ==="
curl -X POST http://localhost:7860/v1/transaction -H "Content-Type: application/json" -d '{"file": "mod_a.js", "code": "module.exports = { status: \"v2.8_atomic_commit\" };"}'
echo ""
echo "=== TESTING ATOMIC TRANSACTION (BROKEN CODE - EXPECT AUTO ROLLBACK) ==="
curl -X POST http://localhost:7860/v1/transaction -H "Content-Type: application/json" -d '{"file": "mod_a.js", "code": "module.exports = { status: broken_code_without_quotes"}'
echo ""
