#!/usr/bin/env bash
set -Eeuo pipefail

WORKERS="${WORKERS:-4}"

start_workers() {
    mkdir -p runtime/{logs,pids}

    for i in $(seq 1 "$WORKERS"); do
        nohup bash kernel/worker.sh \
            > "runtime/logs/worker-$i.log" 2>&1 &

        echo $! > "runtime/pids/worker-$i.pid"

        echo "worker-$i pid=$!"
    done
}
