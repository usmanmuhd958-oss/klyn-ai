#!/usr/bin/env bash
set -Eeuo pipefail

log() {
    local level="${1:-INFO}"
    shift || true
    printf '[%s] [%s] %s\n' \
        "$(date -Iseconds)" \
        "$level" \
        "$*"
}
