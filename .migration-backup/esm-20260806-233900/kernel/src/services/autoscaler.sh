#!/bin/bash
# Placeholder: scales worker agents based on queue depth. In production, integrate with k8s or Docker.
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
QUEUE_DIR="$PROJECT_ROOT/runtime/queue"
MAX_WORKERS=5
while true; do
    pending=$(ls "$QUEUE_DIR"/*.json 2>/dev/null | wc -l)
    running=$(pgrep -f "agents/src/worker" 2>/dev/null | wc -l)
    if [ "$pending" -gt 0 ] && [ "$running" -lt "$MAX_WORKERS" ]; then
        echo "Scaling up: starting worker"
        nohup bash "$PROJECT_ROOT/agents/src/worker.sh" &
    fi
    sleep 10
done
