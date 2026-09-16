#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

ROOT="$HOME/klyn-ai-os"

cd "$ROOT"

echo "================================="
echo " KLYN CANONICAL REPAIR ENGINE"
echo "================================="


mkdir -p architecture/registry
mkdir -p architecture/audit


echo "[1/6] Creating canonical registry"


cat > architecture/registry/CANONICAL_MODULES.md <<'EOF'
# KLYN Canonical Modules

AgentRuntime:
packages/agent-runtime/src/runtime/AgentRuntime.ts

AgentExecutor:
packages/agent-runtime/src/executor/AgentExecutor.ts

AIEngine:
packages/ai-gateway/src/gateway/AIEngine.ts

WorkflowEngine:
packages/workflow-engine/src/WorkflowEngine.ts

MemoryEngine:
intelligence/memory/MemoryEngine.ts
EOF



echo "[2/6] Repairing MemoryEngine bridge"


if [ -f core/memory.ts ]; then

cat > core/memory.ts <<'EOF'
/**
 * @deprecated
 * Use intelligence/memory/MemoryEngine.ts
 */

export {
  MemoryEngine,
  memoryEngine
} from "../intelligence/memory/MemoryEngine.js";
EOF

fi



echo "[3/6] Repairing AgentExecutor bridge"


if [ -f kernel/src/execution/agent_executor.ts ]; then

cat > kernel/src/execution/agent_executor.ts <<'EOF'
/**
 * @deprecated
 * Use packages/agent-runtime/src/executor/AgentExecutor.ts
 */

export {
  AgentExecutor
} from "../../../packages/agent-runtime/src/executor/AgentExecutor.js";
EOF

fi



echo "[4/6] Creating architecture guard"


cat > scripts/architecture-guard.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "[ARCH GUARD] Checking architecture rules"


if grep -R "2.vault\|archive-history\|.migration-backup" \
--include="*.ts" \
packages kernel intelligence core agents; then

echo "Forbidden dependency detected"
exit 1

fi


echo "ARCHITECTURE OK"
EOF


chmod +x scripts/architecture-guard.sh



echo "[5/6] Creating module audit"


cat > scripts/module-intelligence-audit.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash

set -e


OUT="architecture/audit/class-duplicates.txt"

mkdir -p architecture/audit

> "$OUT"


for name in AgentRuntime AIEngine WorkflowEngine MemoryEngine AgentExecutor
do

echo "===== $name =====" >> "$OUT"

grep -R "class $name" \
packages kernel intelligence core agents \
--include="*.ts" \
--exclude-dir=node_modules \
>> "$OUT" || true

echo >> "$OUT"

done


echo "Audit complete: $OUT"
EOF


chmod +x scripts/module-intelligence-audit.sh



echo "[6/6] Running validation"


./scripts/module-intelligence-audit.sh

./scripts/architecture-guard.sh


echo ""
echo "================================="
echo " KLYN CANONICAL REPAIR COMPLETE"
echo "================================="
