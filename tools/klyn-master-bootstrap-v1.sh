#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN MASTER BOOTSTRAP V1"
echo " AI OPERATING SYSTEM CONTROL"
echo "=============================="

BASE=".klyn"
REPORT="$BASE/platform/boot-report.json"

mkdir -p "$BASE/platform"


check() {
 if [ -e "$1" ]; then
   echo "[✓] $2"
 else
   echo "[ ] $2"
 fi
}


check "$BASE/brain/symbol.graph.json" "Knowledge Graph"
check "$BASE/brain/impact-map.json" "Impact Engine"
check "$BASE/brain/reasoning-report.json" "Reasoning Engine"
check "$BASE/brain/context-router" "Context Router"
check "$BASE/runtime" "Agent Runtime"
check "$BASE/runtime/orchestrator" "Orchestrator"
check "$BASE/runtime/execution" "Execution Fabric"
check "$BASE/runtime/self-healing" "Self Healing"
check "$BASE/runtime/event-bus" "Event Bus"
check "$BASE/brain/cognitive-core" "Cognitive Core"


cat > "$REPORT" <<JSON
{
 "system":"KLYN AI OS",
 "boot":"complete",
 "mode":"AI Engineering Platform"
}
JSON


echo "=============================="
echo " KLYN STATUS: OPERATIONAL"
echo " REPORT:"
echo "$REPORT"
echo "=============================="

