#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK="$*"
if [ -z "$TASK" ]; then
    echo "Usage: $0 <task>"
    exit 1
fi
echo "[planner] Processing: $TASK"

# Try the cloud AI first
if node "$PROJECT_ROOT/kernel/src/services/llm_provider.js" "planner" "$TASK" 2>/dev/null; then
    exit 0
fi

# Fallback to local intelligence
echo "[planner] No API available – using offline intelligence."
bash "$PROJECT_ROOT/agents/src/local_intelligence.sh" "$TASK"
