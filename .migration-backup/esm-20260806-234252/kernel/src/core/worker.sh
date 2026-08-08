#!/usr/bin/env bash
set -Eeuo pipefail

source kernel/bootstrap.sh

worker_loop() {
    while true; do
        task="$(next_task 2>/dev/null || true)"

        [[ -z "${task:-}" ]] && {
            sleep 1
            continue
        }

        id="${task%%|*}"
        req="${task#*|}"

        metric_inc tasks_started
        emit_event task.started "$id"

        run_agent "$req"

        emit_event task.completed "$id"
        metric_inc tasks_completed

        pop_task
    done
}

worker_loop
