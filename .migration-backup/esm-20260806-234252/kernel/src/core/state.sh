#!/usr/bin/env bash
set -Eeuo pipefail

STATE_DIR="runtime/state"

state_set() {
    mkdir -p "$STATE_DIR"
    printf '%s\n' "$2" \
        > "$STATE_DIR/$1"
}

state_get() {
    [[ -f "$STATE_DIR/$1" ]] || return 1
    cat "$STATE_DIR/$1"
}

state_del() {
    rm -f "$STATE_DIR/$1"
}
