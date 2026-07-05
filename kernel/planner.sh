#!/usr/bin/env bash
set -Eeuo pipefail

plan_task() {
    local request="$1"

    case "$request" in
        auth*)
            cat <<TASKS
create_schema
create_models
create_endpoints
write_tests
update_docs
TASKS
            ;;
        *)
            echo "$request"
            ;;
    esac
}
