#!/usr/bin/env bash
set -Eeuo pipefail

recover_runtime() {
    mkdir -p runtime/{logs,pids,state}

    find runtime/pids \
        -name '*.pid' \
        -type f \
        -delete
}
