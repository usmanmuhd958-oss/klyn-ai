#!/bin/bash
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
mkdir -p "$PROJECT_ROOT/runtime/logs"

# Start API server directly
node "$PROJECT_ROOT/api/server.js" > "$PROJECT_ROOT/runtime/logs/api.log" 2>&1 &
echo "API started (PID $!)"

# Health loop – restart API if it dies
while true; do
    if ! pgrep -f "node api/server.js" >/dev/null 2>&1; then
        echo "[$(date)] API died, restarting..."
        node "$PROJECT_ROOT/api/server.js" > "$PROJECT_ROOT/runtime/logs/api.log" 2>&1 &
    fi
    sleep 5
done
