#!/bin/bash
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$PROJECT_ROOT/kernel/src/services/process_manager.sh"
source "$PROJECT_ROOT/kernel/src/services/job_queue.sh"

# Ensure runtime dirs
mkdir -p "$PROJECT_ROOT/runtime/pids" "$PROJECT_ROOT/runtime/queue/failed"

# Start critical services
start_service "api" "node $PROJECT_ROOT/api/server.js"
start_service "eventbus" "bash -c 'tail -f $PROJECT_ROOT/runtime/events/jobs.trigger 2>/dev/null | while read line; do process_queue; done'"
start_service "scheduler" "bash -c 'while true; do process_queue; sleep 2; done'"

# Health loop
while true; do
    if ! kill -0 $(cat "$PROJECT_ROOT/runtime/pids/api.pid") 2>/dev/null; then
        echo "[$(date)] API died, restarting..."
        start_service "api" "node $PROJECT_ROOT/api/server.js"
    fi
    # Process the job queue every iteration
    process_queue
    sleep 5
done
