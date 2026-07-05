#!/usr/bin/env bash
set -Eeuo pipefail

worker_loop() {
    while true; do
        process_queue || true
        sleep 1
    done
}

main() {
    worker_loop
}

[[ "${BASH_SOURCE:-}" == "$0" ]] && main
