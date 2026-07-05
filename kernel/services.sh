#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_DIR="runtime/services"

register_service() {
    local name="$1"
    local cmd="$2"

    mkdir -p "$SERVICE_DIR"
    printf '%s\n' "$cmd" \
        > "$SERVICE_DIR/$name.service"
}

service_cmd() {
    cat "$SERVICE_DIR/$1.service"
}
