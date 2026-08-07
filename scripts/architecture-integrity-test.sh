#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "[KLYN INTEGRITY] Running..."

./scripts/module-intelligence-audit.sh
./scripts/architecture-guard.sh
./scripts/dependency-migration-audit.sh


echo "[KLYN INTEGRITY] PASS"
