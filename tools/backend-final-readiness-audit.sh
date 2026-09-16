#!/usr/bin/env bash
set -e

echo "======================================"
echo " KLYN BACKEND FINAL READINESS AUDIT"
echo "======================================"

echo ""
echo "[1] Production Build"

npm run build


echo ""
echo "[2] TypeScript Verification"

npm run typecheck


echo ""
echo "[3] API Contract Inventory"

find src/backend/api-gateway \
src/backend/api-contracts \
-type f \
-name "*.ts" \
| sort


echo ""
echo "[4] Runtime Pipeline Check"

echo "Checking:"
echo "API Gateway"
echo "    -> AI Orchestrator"
echo "    -> Agent Runtime"
echo "    -> Code Intelligence"
echo "    -> Memory"

grep -R "AgentRuntime\|AIOrchestrator\|CodeIntelligence\|Memory" \
packages src/backend \
--include="*.ts" \
-n \
| head -100


echo ""
echo "[5] Git Cleanliness"

git status --short


echo ""
echo "======================================"
echo " BACKEND READINESS AUDIT COMPLETE"
echo "======================================"
