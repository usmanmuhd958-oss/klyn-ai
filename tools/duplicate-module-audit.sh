#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN DUPLICATE MODULE AUDIT"
echo " CANONICAL REGISTRY VALIDATION"
echo "======================================"

TARGETS=(
"AgentRuntime"
"AgentExecutor"
"AIEngine"
"WorkflowEngine"
"MemoryEngine"
"SwarmEngine"
)

for module in "${TARGETS[@]}"
do
    echo ""
    echo "Searching: $module"

    grep -R --include="*.ts" --include="*.tsx" \
    "class $module\|interface $module\|export.*$module" \
    packages kernel intelligence apps 2>/dev/null || true

done


echo ""
echo "======================================"
echo " DUPLICATE AUDIT COMPLETE"
echo " NO FILES MODIFIED"
echo "======================================"
