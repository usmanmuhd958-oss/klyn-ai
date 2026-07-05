#!/usr/bin/env bash
set -Eeuo pipefail

health_check_service() {
    local svc="${1:-scheduler}"

    if service_status "$svc" | grep -q running; then
        echo "$svc healthy"
    else
        echo "$svc unhealthy"
    fi
}

metrics_export() {
    mkdir -p runtime/{services,agents,events}

    echo "services $(find runtime/services -name '*.json' | wc -l)"
    echo "agents $(find runtime/agents -name '*.json' | wc -l)"

    if [[ -f runtime/events/events.log ]]; then
        echo "events $(wc -l < runtime/events/events.log)"
    else
        echo "events 0"
    fi
}

snapshot_state() {
    mkdir -p runtime/snapshots

    local file
    file="runtime/snapshots/$(date +%Y%m%d-%H%M%S).tar.gz"

    tar czf "$file" runtime

    echo "Snapshot: $file"
}
