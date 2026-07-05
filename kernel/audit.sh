#!/usr/bin/env bash
set -Eeuo pipefail

audit() {
    mkdir -p runtime/audit

    printf '%s|%s\n' \
        "$(date -Iseconds)" \
        "$*" \
        >> runtime/audit/audit.log
}
