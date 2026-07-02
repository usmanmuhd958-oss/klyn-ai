#!/usr/bin/env bash

# =============================================================================
# KLYN AI OS - Kernel Daemon (kernel/core/daemon.sh)
# -----------------------------------------------------------------------------
# PURPOSE:
# This daemon is the continuous kernel event loop responsible for:
# - Driving the scheduler dispatcher
# - Maintaining system heartbeat
# - Ensuring continuous job processing
# - Providing graceful shutdown handling
#
# DESIGN PRINCIPLES:
# - Infinite controlled event loop (non-blocking CPU usage)
# - Signal-safe termination (SIGINT, SIGTERM)
# - Logging-driven observability
# - Modular dispatcher delegation
#
# DEPENDENCIES:
# - lib/utils/logger.sh
# - kernel/scheduler/dispatcher.sh
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Resolve KLYN root
# -----------------------------------------------------------------------------
KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# -----------------------------------------------------------------------------
# Source dependencies
# -----------------------------------------------------------------------------
# shellcheck source=/dev/null
source "$KLYN_ROOT/lib/utils/logger.sh"

# shellcheck source=/dev/null
source "$KLYN_ROOT/kernel/scheduler/dispatcher.sh"

RUNNING=true

# -----------------------------------------------------------------------------
# Graceful shutdown handler
# -----------------------------------------------------------------------------
shutdown() {
    klyn_log "WARN" "Kernel daemon shutdown signal received"
    RUNNING=false
    klyn_log "INFO" "Kernel daemon exiting cleanly"
    exit 0
}

trap shutdown SIGINT SIGTERM

# -----------------------------------------------------------------------------
# Main event loop
# -----------------------------------------------------------------------------
main_loop() {
    klyn_log "INFO" "KLYN Kernel Daemon starting..."

    while $RUNNING; do

        # Dispatch jobs (scheduler responsibility)
        if declare -f run_dispatcher >/dev/null 2>&1; then
            run_dispatcher
        else
            klyn_log "ERROR" "Dispatcher function not found"
        fi

        # CPU throttling (prevents busy loop / Termux drain)
        sleep 3

    done
}

# -----------------------------------------------------------------------------
# Start daemon
# -----------------------------------------------------------------------------
main_loop

