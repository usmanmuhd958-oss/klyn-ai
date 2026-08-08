#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK="$*"
echo "[coder] Processing: $TASK"
if node "$PROJECT_ROOT/kernel/src/services/llm_provider.js" "coder" "$TASK" 2>/dev/null; then
    exit 0
fi
if [ -f "$PROJECT_ROOT/kernel/src/services/local_llm_provider.js" ]; then
    node "$PROJECT_ROOT/kernel/src/services/local_llm_provider.js" "$TASK" 2>/dev/null && exit 0
fi
bash "$PROJECT_ROOT/agents/src/local_intelligence.sh" "$TASK"
