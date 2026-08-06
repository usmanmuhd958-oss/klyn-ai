#!/usr/bin/env bash

pipeline() {
    local request="$1"

    remember history "$request"

    emit_event request.received "$request"

    run_agent "$request"
}
