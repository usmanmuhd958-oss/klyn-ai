#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "======================================"
echo " KLYN AI OS BACKEND LOCK FINAL AUDIT"
echo "======================================"

echo
echo "[1] BACKEND STRUCTURE"
echo "--------------------------------------"
tree -L 2 src/backend | head -200

echo
echo "[2] RUNTIME CORE"
echo "--------------------------------------"
tree -L 3 genesis/v670/runtime-core

echo
echo "[3] PACKAGE MODULES"
echo "--------------------------------------"
find packages -maxdepth 3 -type d | sort

echo
echo "[4] TYPESCRIPT VALIDATION"
echo "--------------------------------------"
npm run typecheck

echo
echo "[5] PRODUCTION BUILD"
echo "--------------------------------------"
npm run build

echo
echo "[6] DUPLICATE MODULE DETECTION"
echo "--------------------------------------"
./tools/duplicate-module-audit.sh || true

echo
echo "[7] WORKFLOW ENGINE CHECK"
echo "--------------------------------------"
./tools/workflow-engine-audit.sh || true

echo
echo "[8] MODULE OWNERSHIP CHECK"
echo "--------------------------------------"
./tools/module-ownership-trace.sh || true

echo
echo "[9] GIT STATUS"
echo "--------------------------------------"
git status --short

echo
echo "======================================"
echo " BACKEND LOCK AUDIT COMPLETE"
echo "======================================"
