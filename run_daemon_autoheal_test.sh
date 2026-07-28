#!/bin/bash
fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"
pkill -f "klyn_daemon.js" 2>/dev/null

node klyn_server.js > klyn.log 2>&1 &
sleep 1
node klyn_daemon.js > daemon.log 2>&1 &
sleep 1

echo "=== BREAKING mod_a.js DIRECTLY ON DISK ==="
echo "module.exports = { status: null };" > mod_a.js
sleep 2

echo "=== DAEMON LOG OUTPUT (EXPECT AUTO-HEAL TRIGGER) ==="
cat daemon.log
