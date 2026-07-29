#!/usr/bin/env bash
set -Eeuo pipefail

start_service() {
    local name="${1:?service name required}"
    shift

    mkdir -p runtime/{logs,pids}

    if status_service "$name" >/dev/null 2>&1; then
        klyn_log WARN "$name already running"
        return 0
    fi

    nohup "$@" \
        >> "runtime/logs/${name}.log" \
        2>&1 &

    local pid=$!

    echo "$pid" > "runtime/pids/${name}.pid"
    klyn_log INFO "Started $name pid=$pid"
}

stop_service() {
    local name="${1:?service name required}"
    local pid_file="runtime/pids/${name}.pid"

    [[ -f "$pid_file" ]] || {
        klyn_log WARN "$name not running"
        return 0
    }

    local pid
    pid="$(cat "$pid_file")"

    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"

    klyn_log INFO "Stopped $name pid=$pid"
}

status_service() {
    local name="${1:?service name required}"
    local pid_file="runtime/pids/${name}.pid"

    [[ -f "$pid_file" ]] || return 1

    local pid
    pid="$(cat "$pid_file")"

    kill -0 "$pid" 2>/dev/null
}
