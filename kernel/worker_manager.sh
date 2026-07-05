#!/usr/bin/env bash
set -Eeuo pipefail

start_workers() {
    local n="${WORKERS:-4}"

    mkdir -p runtime/{pids,logs}

    for ((i=1; i<=n; i++)); do
        bash kernel/workers/worker.sh \
            >> "runtime/logs/worker-$i.log" 2>&1 &

        echo $! > "runtime/pids/worker-$i.pid"
    done
}

stop_workers() {
    pkill -f 'kernel/workers/worker.sh' || true
    rm -f runtime/pids/worker-*.pid
}
