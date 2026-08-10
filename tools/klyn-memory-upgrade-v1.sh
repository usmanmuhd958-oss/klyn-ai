#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="$HOME/klyn-ai-os"
BACKUP="$ROOT/backups/klyn-memory-upgrade"

echo "=============================="
echo " KLYN MEMORY UPGRADE V1"
echo " SAFE PATCH MODE"
echo "=============================="

cd "$ROOT"

mkdir -p "$BACKUP"

cp index.js "$BACKUP/index.js.$(date +%Y%m%d-%H%M%S)"
cp klyn_server.js "$BACKUP/klyn_server.js.$(date +%Y%m%d-%H%M%S)"

echo "[1] Backups created"

if grep -q "fs.readdirSync(this.workDir)" klyn_server.js; then
    echo "[2] Current scanner detected"
else
    echo "[2] Scanner pattern changed - stopping safely"
    exit 1
fi

echo "[3] No destructive changes applied"
echo "[4] Backup:"
echo "$BACKUP"

echo "=============================="
echo " READY"
echo "=============================="
