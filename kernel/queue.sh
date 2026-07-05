#!/usr/bin/env bash
set -Eeuo pipefail

QUEUE_DIR="runtime/queue"
QUEUE_FILE="$QUEUE_DIR/tasks.log"

submit_task() {
    mkdir -p "$QUEUE_DIR"

    printf '%s|%s\n' \
        "$(date +%s%N)" \
        "$1" \
        >> "$QUEUE_FILE"
}

next_task() {
    [[ -f "$QUEUE_FILE" ]] || return 1
    head -n1 "$QUEUE_FILE"
}

pop_task() {
    [[ -f "$QUEUE_FILE" ]] || return 1
    sed -i '1d' "$QUEUE_FILE"
}
