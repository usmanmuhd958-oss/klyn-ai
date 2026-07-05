#!/usr/bin/env bash
set -Eeuo pipefail

emit_event() {
    mkdir -p runtime/events

    printf '%s|%s|%s\n' \
        "$(date -Iseconds)" \
        "$1" \
        "$2" \
        >> runtime/events/events.log
}

list_events() {
    [[ -f runtime/events/events.log ]] &&
        cat runtime/events/events.log
}
