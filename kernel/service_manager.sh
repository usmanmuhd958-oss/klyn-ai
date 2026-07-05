#!/usr/bin/env bash
set -Eeuo pipefail

mkdir -p runtime/{pids,logs,services}

start_service() {
    local name="$1"
    local cmd="$2"

    pgrep -f "$cmd" >/dev/null && return 0

    bash "$cmd" >>"runtime/logs/${name}.log" 2>&1 &
    local pid=$!

    echo "$pid" > "runtime/pids/${name}.pid"

    cat > "runtime/services/${name}.json" <<JSON
{
  "name":"$name",
  "pid":$pid,
  "status":"running",
  "started":"$(date -Iseconds)"
}
JSON
}

stop_service() {
    local name="$1"

    [[ -f "runtime/pids/${name}.pid" ]] || return 0

    kill "$(cat "runtime/pids/${name}.pid")" \
        2>/dev/null || true

    rm -f "runtime/pids/${name}.pid"
}

service_status() {
    local name="$1"

    if [[ -f "runtime/pids/${name}.pid" ]]; then
        local pid
        pid=$(cat "runtime/pids/${name}.pid")

        if kill -0 "$pid" 2>/dev/null; then
            echo "$name running pid=$pid"
            return
        fi
    fi

    echo "$name stopped"
}

list_services() {
    find runtime/services \
        -name '*.json' \
        -exec basename {} .json \;
}
