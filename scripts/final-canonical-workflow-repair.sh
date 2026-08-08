#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

echo "================================="
echo " KLYN WORKFLOW CANONICAL REPAIR"
echo "================================="


WORKFLOW_FILE="kernel/workflow.ts"


if [ -f "$WORKFLOW_FILE" ]; then

cat > "$WORKFLOW_FILE" <<'EOF'
/**
 * @deprecated
 *
 * KLYN WorkflowEngine moved to:
 *
 * packages/workflow-engine/src/WorkflowEngine.ts
 *
 * This file remains as compatibility layer.
 */

export {
  WorkflowEngine
} from "../packages/workflow-engine/src/WorkflowEngine.js";

EOF

echo "[FIXED] kernel/workflow.ts bridge created"

fi



echo "[AUDIT] Running module scan"

./scripts/module-intelligence-audit.sh


echo "[AUDIT] Checking architecture"

./scripts/architecture-guard.sh


echo ""
echo "================================="
echo " WORKFLOW MIGRATION COMPLETE"
echo "================================="
