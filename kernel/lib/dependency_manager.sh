#!/usr/bin/env bash
set -Eeuo pipefail

start_with_deps() {
    local svc="$1"

    for dep in $(service_dependencies "$svc")
    do
        service_status "$dep" | grep -q running ||
            start_service \
                "$dep" \
                "kernel/services/${dep}.sh"
    done

    service_status "$svc" | grep -q running ||
        start_service \
            "$svc" \
            "kernel/services/${svc}.sh"
}
