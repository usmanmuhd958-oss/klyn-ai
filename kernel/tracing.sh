#!/usr/bin/env bash
set -Eeuo pipefail

trace_begin() {
    mkdir -p runtime/traces
    echo "$(date +%s%N)" > "runtime/traces/$1.start"
}

trace_end() {
    local start
    start="$(cat runtime/traces/$1.start)"

    echo "$(( $(date +%s%N) - start ))" \
        > "runtime/traces/$1.duration"
}
