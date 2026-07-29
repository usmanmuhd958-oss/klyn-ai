#!/bin/bash
# Enterprise AI Scheduler – priority + resource-aware
SCHEDULER_LOG="${PROJECT_ROOT:-..}/runtime/logs/scheduler.log"
JOBS_DIR="${PROJECT_ROOT:-..}/runtime/jobs"

schedule_job() {
    local agent="$1"
    local payload="$2"
    local priority="${3:-5}"
    local id=$(date +%s%N)
    echo "{\"id\":\"$id\",\"agent\":\"$agent\",\"payload\":\"$payload\",\"priority\":$priority}" > "$JOBS_DIR/$id.json"
    echo "[$(date)] SCHEDULED $agent:$id (priority $priority)" >> "$SCHEDULER_LOG"
    # trigger worker (via event bus)
    echo "job:$agent" >> "${PROJECT_ROOT:-..}/runtime/events/jobs.trigger"
}

# Example usage: schedule_job "coder" "build UI" 8
