#!/usr/bin/env bash
set -Eeuo pipefail

orchestrate() {
    local task="$1"

    local agent
    agent="$(route_task "$task")"

    emit_event task.assigned "$task -> $agent"

    run_agent "$task"
}
