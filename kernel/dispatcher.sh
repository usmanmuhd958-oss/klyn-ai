#!/usr/bin/env bash
set -Eeuo pipefail

dispatch() {
    local task="$1"
    local agent

    agent="$(route_task "$task")"

    emit_event task.dispatched \
        "$task -> $agent"

    printf '[%s] -> %s\n' \
        "$task" \
        "$agent"
}
