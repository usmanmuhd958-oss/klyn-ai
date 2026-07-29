#!/usr/bin/env bash

retry() {
    local max="${RETRY_MAX:-5}"
    local delay="${RETRY_DELAY:-1}"
    local attempt=1

    while true; do
        "$@" && return 0

        (( attempt >= max )) && return 1

        klyn_log WARN \
            "Attempt $attempt failed, retrying in ${delay}s"

        sleep "$delay"
        delay=$((delay * 2))
        attempt=$((attempt + 1))
    done
}
