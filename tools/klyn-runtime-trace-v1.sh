#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN RUNTIME TRACE V1"
echo "=============================="

FILE="klyn_server.js"

cp "$FILE" backups/klyn-runtime-trace-v1/$FILE.$(date +%Y%m%d-%H%M%S)

echo "[1] Server start markers"

grep -n "function startServer\|server.listen\|new KlynServerEngine\|constructor\|indexCodebase\|loadIndexCache" "$FILE"

echo
echo "[2] Memory/cache size"

ls -lh vault_data 2>/dev/null || true
ls -lh .klyn-index* 2>/dev/null || true

echo
echo "[3] Running process"

ps -ef | grep klyn_server.js | grep -v grep || true

echo
echo "[4] Node handles"

node --trace-uncaught klyn_server.js
