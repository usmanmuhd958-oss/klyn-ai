#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN RUNTIME SAFE BOOTSTRAP V3"
echo "=============================="

BACKUP="backups/klyn-runtime-v3"

mkdir -p "$BACKUP"

cp klyn_server.js "$BACKUP/klyn_server.js.$(date +%Y%m%d-%H%M%S)"

echo "[1] Checking syntax"

node --check klyn_server.js

echo "[2] Checking listeners"

pkill -f "node klyn_server.js" || true

echo "[3] Starting controlled runtime"

nohup node klyn_server.js > klyn-runtime.log 2>&1 &

sleep 5

echo "[4] Runtime status"

ps -ef | grep klyn_server.js | grep -v grep || true

echo "[5] Port check"

curl -s http://localhost:7860/v1/memory-status || true

echo
echo "=============================="
echo " READY"
echo " Backup:"
echo "$BACKUP"
echo "=============================="
