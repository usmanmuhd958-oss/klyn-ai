#!/usr/bin/env bash
set -Eeuo pipefail

PID_DIR="${KLYN_ROOT}/runtime/pids"

save_pid() {
    mkdir -p "$PID_DIR"
    echo "$2" > "$PID_DIR/$1.pid"
}

read_pid() {
    cat "$PID_DIR/$1.pid" 2>/dev/null || true
}

remove_pid() {
    rm -f "$PID_DIR/$1.pid"
}

is_alive() {
    kill -0 "$1" 2>/dev/null
}

export -f save_pid
export -f read_pid
export -f remove_pid
export -f is_alive
