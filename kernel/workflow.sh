#!/usr/bin/env bash
set -Eeuo pipefail

run_workflow() {
    local request="$1"

    while read -r step; do
        [[ -z "$step" ]] && continue

        emit_event workflow.step "$step"
        submit_task "$step"

    done < <(plan_task "$request")
}
