#!/bin/bash
fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"
pkill -f "klyn_daemon.js" 2>/dev/null

node klyn_server.js > klyn.log 2>&1 &
sleep 1
node klyn_daemon.js > daemon.log 2>&1 &
sleep 1

echo "=== MODIFYING mod_a.js DIRECTLY TO TRIGGER REAL-TIME WATCHER ==="
echo "module.exports = { status: 'daemon_watched_v3.2' };" > mod_a.js
sleep 1

echo "=== DAEMON LOG OUTPUT ==="
cat daemon.log
