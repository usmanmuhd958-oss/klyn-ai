#!/bin/bash
# Multi‑agent orchestration using the scheduler + event bus
ORCHESTRATOR_LOG="${PROJECT_ROOT:-..}/runtime/logs/orchestrator.log"

run_pipeline() {
    local goal="$1"
    echo "[$(date)] Starting pipeline: $goal" >> "$ORCHESTRATOR_LOG"
    # 1. Plan
    schedule_job "planner" "$goal"
    # 2. Code / execute
    schedule_job "coder" "$goal"
    # 3. Review
    schedule_job "reviewer" "$goal"
}
