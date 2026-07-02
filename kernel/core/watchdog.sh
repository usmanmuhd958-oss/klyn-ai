#!/usr/bin/env bash

# =============================================================================
# KLYN AI OS - System Watchdog (kernel/core/watchdog.sh)
# -----------------------------------------------------------------------------
# PURPOSE:
# This watchdog ensures kernel daemon resilience by continuously monitoring
# the kernel event loop process and restarting it if it fails.
#
# DESIGN GOALS:
# - Self-healing kernel supervision
# - PID-based liveness detection
# - Automatic daemon recovery
# - CRITICAL failure escalation logging
#
# DEPENDENCIES:
# - lib/utils/logger.sh
# - kernel/core/daemon.sh
#
# PID CONTRACT:
# - runtime/pids/kernel.pid must contain active daemon PID
# =============================================================================

set -euo pipefail

KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

source "$KLYN_ROOT/lib/utils/logger.sh"

DAEMON="$KLYN_ROOT/kernel/core/daemon.sh"
PID_FILE="$KLYN_ROOT/runtime/pids/kernel.pid"

mkdir -p "$KLYN_ROOT/runtime/pids"

# -----------------------------------------------------------------------------
# Start daemon and register PID
# -----------------------------------------------------------------------------
start_daemon() {
    klyn_log "WARN" "Restarting kernel daemon..."

    bash "$DAEMON" &
    DAEMON_PID=$!

    echo "$DAEMON_PID" > "$PID_FILE"

    klyn_log "INFO" "Kernel daemon restarted with PID $DAEMON_PID"
}

# -----------------------------------------------------------------------------
# Check if PID is alive
# -----------------------------------------------------------------------------
is_alive() {
    local pid="$1"

    if [[ -z "$pid" ]]; then
        return 1
    fi

    kill -0 "$pid" 2>/dev/null
}

# -----------------------------------------------------------------------------
# Watchdog loop
# -----------------------------------------------------------------------------
klyn_log "INFO" "Watchdog initialized"

while true; do

    if [[ ! -f "$PID_FILE" ]]; then
        klyn_log "CRITICAL" "PID file missing. Kernel daemon not registered."
        start_daemon
        sleep 2
        continue
    fi

    PID=$(cat "$PID_FILE")

    if is_alive "$PID"; then
        klyn_log "INFO" "Kernel daemon healthy (PID=$PID)"
    else
        klyn_log "CRITICAL" "Kernel daemon DEAD or unreachable (PID=$PID)"
        start_daemon
    fi

    sleep 5

done

