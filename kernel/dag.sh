#!/usr/bin/env bash
set -Eeuo pipefail

declare -A TASK_DEPS

TASK_DEPS[create_models]="create_schema"
TASK_DEPS[create_endpoints]="create_models"
TASK_DEPS[write_tests]="create_endpoints"
TASK_DEPS[update_docs]="create_endpoints"

can_run() {
    local task="$1"

    for dep in ${TASK_DEPS[$task]:-}; do
        [[ -f "runtime/state/${dep}.done" ]] || return 1
    done

    return 0
}

mark_done() {
    mkdir -p runtime/state
    touch "runtime/state/$1.done"
}
