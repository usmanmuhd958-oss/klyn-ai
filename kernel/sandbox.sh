#!/usr/bin/env bash
set -Eeuo pipefail

run_sandbox() {
    local cmd="$*"

    mkdir -p runtime/logs

    timeout 30 bash -c "$cmd" \
        > runtime/logs/sandbox.out \
        2> runtime/logs/sandbox.err
}

create_workspace() {
    local id="$1"

    mkdir -p \
        "runtime/workspaces/$id/src" \
        "runtime/workspaces/$id/build" \
        "runtime/workspaces/$id/cache" \
        "runtime/workspaces/$id/logs" \
        "runtime/workspaces/$id/state"
}
