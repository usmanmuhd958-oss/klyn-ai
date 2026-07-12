#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK="$*"
echo "[smart_coder] Processing: $TASK"

# Check memory for similar past tasks
PAST=$(node "$PROJECT_ROOT/kernel/src/services/agent_memory.js" recall "$TASK" 2>/dev/null)
if [ -n "$PAST" ] && [ "$PAST" != "[]" ]; then
    echo "[smart_coder] Found similar past tasks, using as reference..."
    echo "$PAST" | jq -r '.[0].result' 2>/dev/null | head -20
fi

# Get best model based on past performance
BEST_MODEL=$(node "$PROJECT_ROOT/kernel/src/services/agent_memory.js" best 2>/dev/null || echo "local")
echo "[smart_coder] Using model: $BEST_MODEL"

# Generate with best model
START_TIME=$(date +%s%3N)
RESULT=$(node "$PROJECT_ROOT/kernel/src/services/llm_provider.js" "$TASK" "$BEST_MODEL" 2>/dev/null)
END_TIME=$(date +%s%3N)
ELAPSED=$((END_TIME - START_TIME))

if [ -n "$RESULT" ]; then
    echo "$RESULT"
    # Record successful task in memory
    node "$PROJECT_ROOT/kernel/src/services/agent_memory.js" learn "task:$TASK" "$RESULT" 0.9 2>/dev/null
else
    # Fallback to offline template
    bash "$PROJECT_ROOT/agents/src/local_intelligence.sh" "$TASK"
fi
