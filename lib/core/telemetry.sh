#!/usr/bin/env bash

# =============================================================================
# KLYN AI OS - Telemetry System (lib/core/telemetry.sh)
# -----------------------------------------------------------------------------
# PURPOSE:
# This module provides lightweight, file-based observability primitives
# for the KLYN AI OS kernel.
#
# DESIGN GOALS:
# - Structured metrics collection (key/value)
# - Thread-safe concurrent updates
# - Minimal overhead (bash + file-based storage)
# - Kernel-wide observability foundation
#
# STORAGE LAYER:
#   runtime/metrics/<key>.metric
# =============================================================================

set -euo pipefail

KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

METRICS_DIR="$KLYN_ROOT/runtime/metrics"
LOCK_FILE="$METRICS_DIR/.metrics.lock"

mkdir -p "$METRICS_DIR"

# -----------------------------------------------------------------------------
# Ensure flock lock exists
# -----------------------------------------------------------------------------
exec 200>"$LOCK_FILE"

# -----------------------------------------------------------------------------
# RECORD METRIC
# Usage:
#   record_metric "jobs_processed" "10"
# -----------------------------------------------------------------------------
record_metric() {
    local key="$1"
    local value="$2"
    local file="$METRICS_DIR/$key.metric"

    flock -x 200

    # Atomic overwrite using temp file
    local tmp_file="${file}.tmp"

    echo "$value" > "$tmp_file"
    mv "$tmp_file" "$file"

    flock -u 200
}

# -----------------------------------------------------------------------------
# GET METRIC
# Usage:
#   get_metric "jobs_processed"
# -----------------------------------------------------------------------------
get_metric() {
    local key="$1"
    local file="$METRICS_DIR/$key.metric"

    if [[ -f "$file" ]]; then
        cat "$file"
    else
        echo "0"
    fi
}

# -----------------------------------------------------------------------------
# HEALTH REPORT GENERATOR
# -----------------------------------------------------------------------------
generate_health_report() {
    local uptime_seconds
    uptime_seconds=$(cat /proc/uptime 2>/dev/null | awk '{print $1}' || echo "0")

    local jobs errors

    jobs=$(get_metric "total_jobs_processed")
    errors=$(get_metric "total_errors")

    echo "================ KLYN AI OS HEALTH REPORT ================"
    echo "Uptime (system):      $uptime_seconds seconds"
    echo "Jobs Processed:       $jobs"
    echo "Total Errors:         $errors"
    echo "==========================================================="
}

# Export functions
export -f record_metric
export -f get_metric
export -f generate_health_report

