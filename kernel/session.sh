#!/usr/bin/env bash
set -Eeuo pipefail

SESSION_DIR="runtime/sessions"

start_session() {
    local id
    id="$(date +%s)"

    mkdir -p "$SESSION_DIR"
    touch "$SESSION_DIR/$id.log"

    echo "$id"
}

session_write() {
    local id="$1"
    shift

    printf '%s\n' "$*" \
        >> "$SESSION_DIR/$id.log"
}

session_read() {
    cat "$SESSION_DIR/$1.log"
}
