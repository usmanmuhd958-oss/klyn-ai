#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN MODULE OWNERSHIP TRACE"
echo " DEPENDENCY ANALYSIS"
echo "======================================"

TARGETS=(
"agent_executor"
"AdvancedWorkflowEngine"
)

for target in "${TARGETS[@]}"
do
    echo ""
    echo "Tracing: $target"

    grep -R --include="*.ts" --include="*.tsx" \
    "$target" \
    packages kernel intelligence apps 2>/dev/null || true

done


echo ""
echo "======================================"
echo " OWNERSHIP TRACE COMPLETE"
echo "======================================"
