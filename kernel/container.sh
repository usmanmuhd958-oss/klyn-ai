#!/usr/bin/env bash
set -Eeuo pipefail

declare -A CONTAINER

bind() {
    CONTAINER["$1"]="$2"
}

resolve() {
    printf '%s\n' "${CONTAINER[$1]:-}"
}
