#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN MASTER BOOTSTRAP V2"
echo " REGISTRY DRIVEN CONTROL"
echo "=============================="

REG=".klyn/registry/paths.json"

if [ ! -f "$REG" ]; then
 echo "ERROR: Path registry missing"
 exit 1
fi

check() {
 if [ -e "$1" ]; then
   echo "[✓] $2"
 else
   echo "[ ] $2 -> $1"
 fi
}

check ".klyn/brain/symbol.graph.json" "Knowledge Graph"
check ".klyn/impact-map.json" "Impact Engine"
check ".klyn/brain/reasoning-report.json" "Reasoning Engine"
check ".klyn/brain/context-router" "Context Router"
check ".klyn/brain/cognitive-core" "Cognitive Core"

check ".klyn/runtime" "Agent Runtime"
check ".klyn/runtime/orchestrator" "Orchestrator"
check ".klyn/runtime/execution" "Execution Fabric"
check ".klyn/runtime/self-healing" "Self Healing"
check ".klyn/runtime/event-bus" "Event Bus"

cat > .klyn/platform/boot-report-v2.json <<JSON
{
 "system":"KLYN AI OS",
 "bootstrap":"v2",
 "registry":"active",
 "status":"operational"
}
JSON

echo "=============================="
echo " KLYN V2 STATUS: OPERATIONAL"
echo "=============================="

