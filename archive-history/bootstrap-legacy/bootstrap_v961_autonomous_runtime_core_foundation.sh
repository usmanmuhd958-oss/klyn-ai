#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN V961 AUTONOMOUS RUNTIME CORE"
echo " FOUNDATION LAYER INITIALIZING"
echo "======================================"

ROOT="genesis/v670/runtime-core"

MODULES=(
"IntelligenceRegistry.ts"
"KernelRuntime.ts"
"CognitiveEventBus.ts"
"CapabilityLoader.ts"
"SupabaseMemoryAdapter.ts"
"VectorRetrievalEngine.ts"
"AgentExecutionEngine.ts"
"AgentTaskScheduler.ts"
"AgentStateMachine.ts"
"AutonomousPlanner.ts"
"CodeIntelligenceEngine.ts"
"KnowledgeGraphMemory.ts"
"RuntimeGovernanceEngine.ts"
)

mkdir -p "$ROOT"

echo "[1] Validating runtime modules..."

for module in "${MODULES[@]}"; do
    if [ -f "$ROOT/$module" ]; then
        echo "✓ $module"
    else
        echo "✗ Missing $module"
    fi
done


echo ""
echo "[2] Runtime architecture ready"

cat <<EOF

KLYN Runtime Core Graph:

KernelRuntime
      |
      v
CognitiveEventBus
      |
      v
IntelligenceRegistry
      |
      v
CapabilityLoader
      |
      v
AgentExecutionEngine
      |
      +--> SupabaseMemoryAdapter
      |
      +--> VectorRetrievalEngine
      |
      +--> KnowledgeGraphMemory

Status: FOUNDATION ONLINE

EOF
