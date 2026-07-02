#!/usr/bin/env bash
set -euo pipefail

KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
QUEUE_DIR="$KLYN_ROOT/runtime/queues"
mkdir -p "$QUEUE_DIR"

source "$KLYN_ROOT/lib/utils/logger.sh"
source "$KLYN_ROOT/lib/core/lease_manager.sh"

run_dispatcher() {
    # Check if there are any jobs (supress output if none exist to avoid spam)
    if ! ls "$QUEUE_DIR"/*.job >/dev/null 2>&1; then
        return 0
    fi

    for job_file in "$QUEUE_DIR"/*.job; do
        [[ -e "$job_file" ]] || continue
        local job_name
        job_name=$(basename "$job_file")

        if acquire_lease "job_$job_name"; then
            klyn_log "INFO" "Executing job: $job_name"
            if bash "$job_file"; then
                klyn_log "INFO" "Job $job_name completed successfully."
            else
                klyn_log "ERROR" "Job $job_name failed."
            fi
            rm -f "$job_file"
            release_lease "job_$job_name"
        fi
    done
}

export -f run_dispatcher
