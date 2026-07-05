#!/usr/bin/env bash
set -Eeuo pipefail

watch_service() {
    local svc="$1"
    shift

    while true; do
        if ! status_service "$svc"; then
            klyn_log WARN "$svc crashed"

            emit_event service.restart "$svc"

            start_service "$svc" "$@"
        fi

        sleep 5
    done
}
