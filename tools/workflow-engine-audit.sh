#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN WORKFLOW ENGINE AUDIT"
echo " CANONICAL CONSOLIDATION CHECK"
echo "======================================"

echo ""
echo "WorkflowEngine references:"
grep -R --include="*.ts" --include="*.tsx" \
"WorkflowEngine" \
packages kernel intelligence apps 2>/dev/null || true


echo ""
echo "AdvancedWorkflowEngine references:"
grep -R --include="*.ts" --include="*.tsx" \
"AdvancedWorkflowEngine" \
packages kernel intelligence apps 2>/dev/null || true


echo ""
echo "======================================"
echo " WORKFLOW AUDIT COMPLETE"
echo "======================================"
