#!/usr/bin/env bash
set -Eeuo pipefail

source lib/bootstrap.sh

while true; do
    if ! status_service scheduler; then
        klyn_log ERROR "Scheduler crashed, restarting..."
        start_service scheduler bash kernel/scheduler.sh
    fi
    sleep 5
done
