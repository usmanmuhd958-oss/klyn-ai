#!/bin/bash
fuser -k 7860/tcp 2>/dev/null || pkill -f "klyn_server.js"
node klyn_server.js > klyn.log 2>&1 &
sleep 1
node klyn_cli.js orchestrate mod_a.js "module.exports = { status: 'v2.7_cli_active', timestamp: Date.now() };"
