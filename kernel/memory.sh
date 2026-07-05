#!/usr/bin/env bash
set -Eeuo pipefail

MEMORY_DIR="runtime/memory"

remember() {
    local category="$1"
    local value="$2"

    mkdir -p "$MEMORY_DIR"

    printf '%s\n' "$value" \
        >> "$MEMORY_DIR/${category}.log"
}

recall() {
    local category="$1"

    [[ -f "$MEMORY_DIR/${category}.log" ]] || return 0
    tail -n 20 "$MEMORY_DIR/${category}.log"
}
