#!/usr/bin/env bash
set -Eeuo pipefail

EVENT_DIR="runtime/events"

emit_event() {
    local type="$1"
    local payload="$2"

    mkdir -p "$EVENT_DIR"

    printf '%s|%s|%s\n' \
        "$(date -Iseconds)" \
        "$type" \
        "$payload" \
        >> "$EVENT_DIR/events.log"
}

tail_events() {
    tail -f "$EVENT_DIR/events.log"
}
