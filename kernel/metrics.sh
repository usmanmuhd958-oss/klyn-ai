#!/usr/bin/env bash
set -Eeuo pipefail

metric_inc() {
    local metric="$1"
    mkdir -p runtime/metrics

    local file="runtime/metrics/${metric}.count"
    local value=0

    [[ -f "$file" ]] && value=$(cat "$file")

    echo $((value + 1)) > "$file"
}

metric_set() {
    local metric="$1"
    local value="$2"

    mkdir -p runtime/metrics
    echo "$value" > "runtime/metrics/$metric"
}

metric_get() {
    local metric="$1"
    cat "runtime/metrics/$metric" 2>/dev/null || echo 0
}
