#!/usr/bin/env bash
set -e

echo "======================================"
echo " AGENT RUNTIME PACKAGE BOUNDARY AUDIT"
echo "======================================"

echo ""
echo "[1] Searching package manifests"

find . -maxdepth 3 \
-name package.json \
| grep -E "agent|runtime|package" \
| sort


echo ""
echo "[2] Checking workspace configuration"

echo "--- root package.json ---"

cat package.json | grep -A20 -B5 "workspaces" || true


echo ""
echo "[3] Checking tsconfig paths"

grep -n "agent-runtime" tsconfig.json || true


echo ""
echo "[4] Checking package source"

ls -la packages/agent-runtime


echo ""
echo "[5] Checking exports"

find packages/agent-runtime/src \
-maxdepth 2 \
-type f \
-name "index.ts" \
-print


echo ""
echo "======================================"
echo " AUDIT COMPLETE"
echo "======================================"
