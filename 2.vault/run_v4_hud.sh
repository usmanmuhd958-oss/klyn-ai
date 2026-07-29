#!/bin/bash
fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"
pkill -f "klyn_daemon.js" 2>/dev/null

node klyn_server.js > klyn.log 2>&1 &
sleep 1
node klyn_daemon.js > daemon.log 2>&1 &
sleep 1

echo "=== TESTING TELEMETRY ENDPOINT ==="
curl -s http://localhost:7860/v1/telemetry
echo ""
