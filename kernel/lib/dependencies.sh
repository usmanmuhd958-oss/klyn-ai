#!/usr/bin/env bash
set -Eeuo pipefail

start_with_deps() {
    local svc="$1"

    [[ -f runtime/services/dependencies.conf ]] || {
        echo "No dependency file"
        return 1
    }

    local deps
    deps=$(grep "^${svc}:" \
        runtime/services/dependencies.conf \
        | cut -d: -f2)

    for dep in $deps
    do
        start_service "$dep" \
            "kernel/services/${dep}.sh"
    done

    start_service "$svc" \
        "kernel/services/${svc}.sh"
}
