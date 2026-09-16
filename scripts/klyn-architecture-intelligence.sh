#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

echo "================================="
echo " KLYN ARCHITECTURE INTELLIGENCE "
echo "================================="


mkdir -p architecture/graph
mkdir -p architecture/intelligence
mkdir -p architecture/validators


echo "[1] Creating module graph"


cat > architecture/graph/canonical-map.json <<'EOF'
{
  "modules": {
    "AgentRuntime": {
      "authority": "packages/agent-runtime/src/runtime/AgentRuntime.ts"
    },
    "AgentExecutor": {
      "authority": "packages/agent-runtime/src/executor/AgentExecutor.ts"
    },
    "AIEngine": {
      "authority": "packages/ai-gateway/src/gateway/AIEngine.ts"
    },
    "WorkflowEngine": {
      "authority": "packages/workflow-engine/src/WorkflowEngine.ts"
    },
    "MemoryEngine": {
      "authority": "intelligence/memory/MemoryEngine.ts"
    }
  }
}
EOF



echo "[2] Creating drift detector"


cat > architecture/validators/drift-detector.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash

set -e


echo "[DRIFT CHECK]"


if grep -R "class AgentRuntime" \
--include="*.ts" \
packages kernel intelligence core agents \
| grep -v "packages/agent-runtime/src/runtime/AgentRuntime.ts"; then

echo "AgentRuntime duplicate detected"
exit 1

fi


if grep -R "class MemoryEngine" \
--include="*.ts" \
packages kernel intelligence core agents \
| grep -v "intelligence/memory/MemoryEngine.ts"; then

echo "MemoryEngine duplicate detected"
exit 1

fi


echo "NO ARCHITECTURE DRIFT"
EOF


chmod +x architecture/validators/drift-detector.sh



echo "[3] Creating architecture agent"


cat > architecture/intelligence/architecture-agent.ts <<'EOF'
export class ArchitectureAgent {

  analyze() {

    return {
      status: "healthy",
      role: "architecture-governance",
      authority: [
        "AgentRuntime",
        "AgentExecutor",
        "AIEngine",
        "WorkflowEngine",
        "MemoryEngine"
      ]
    };

  }

}
EOF



echo "[4] Running drift detection"

./architecture/validators/drift-detector.sh


echo ""
echo "================================="
echo " ARCHITECTURE INTELLIGENCE READY "
echo "================================="
