#!/usr/bin/env bash
set -e

echo "======================================"
echo " AGENT RUNTIME MODULE RESOLUTION AUDIT"
echo "======================================"

echo ""
echo "[1] Root tsconfig"

cat tsconfig.json | sed -n '1,80p'


echo ""
echo "[2] Kernel tsconfig files"

find kernel -name "tsconfig*.json" -print


echo ""
echo "[3] Package files"

echo "--- agent runtime index ---"
cat packages/agent-runtime/src/index.ts

echo ""
echo "--- executor index ---"
cat packages/agent-runtime/src/executor/index.ts


echo ""
echo "[4] Check exact import"

sed -n '1,20p' kernel/src/execution/agent_executor.ts


echo ""
echo "[5] TypeScript trace"

npx tsc \
--noEmit \
-p tsconfig.json \
--traceResolution \
2>&1 | grep -A8 "@klyn/agent-runtime/executor" || true


echo ""
echo "======================================"
echo " AUDIT COMPLETE"
echo "======================================"
