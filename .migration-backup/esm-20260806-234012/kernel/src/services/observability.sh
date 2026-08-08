#!/bin/bash
LOG_DIR="${PROJECT_ROOT:-..}/runtime/logs"
METRICS_DIR="${PROJECT_ROOT:-..}/runtime/metrics"

log_info() {
    echo "[$(date)] [INFO] $1" >> "$LOG_DIR/system.log"
}

log_error() {
    echo "[$(date)] [ERROR] $1" >> "$LOG_DIR/system.log"
}

record_metric() {
    local name="$1"
    local value="$2"
    echo "$name $value" >> "$METRICS_DIR/$name.log"
}
