#!/usr/bin/env bash

# =============================================================================
# KLYN AI OS - Lifecycle Manager (lib/core/lifecycle.sh)
# -----------------------------------------------------------------------------
# PURPOSE:
# Manages OS lifecycle states with atomic persistence and health monitoring.
#
# STATES:
# BOOTING | INITIALIZING | READY | RUNNING | ERROR | SHUTDOWN
#
# DESIGN GOALS:
# - Deterministic OS state transitions
# - Atomic state persistence (prevents corruption)
# - Continuous health verification loop
# =============================================================================

set -euo pipefail

KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

STATE_DIR="$KLYN_ROOT/runtime/state"
STATE_FILE="$STATE_DIR/state.lock"
LOCK_FILE="$STATE_DIR/state.lock.tmp"

mkdir -p "$STATE_DIR"

# -----------------------------------------------------------------------------
# ATOMIC STATE WRITER
# -----------------------------------------------------------------------------
set_state() {
    local new_state="$1"

    local timestamp
    timestamp="$(date -Iseconds)"

    local pid="$$"

    {
        echo "STATE=$new_state"
        echo "TIMESTAMP=$timestamp"
        echo "PID=$pid"
    } > "$LOCK_FILE"

    mv "$LOCK_FILE" "$STATE_FILE"
}

# -----------------------------------------------------------------------------
# GET CURRENT STATE
# -----------------------------------------------------------------------------
get_state() {
    if [[ -f "$STATE_FILE" ]]; then
        grep "^STATE=" "$STATE_FILE" | cut -d'=' -f2
    else
        echo "BOOTING"
    fi
}

# -----------------------------------------------------------------------------
# VERIFY STATE
# -----------------------------------------------------------------------------
verify_state() {
    local expected="$1"
    local current

    current=$(get_state)

    if [[ "$current" != "$expected" ]]; then
        return 1
    fi

    return 0
}

# -----------------------------------------------------------------------------
# HEALTH CHECK LOOP
# -----------------------------------------------------------------------------
health_check_loop() {
    while true; do

        local state
        state=$(get_state)

        case "$state" in
            ERROR)
                echo "[LIFECYCLE] ERROR state detected"
                ;;
            SHUTDOWN)
                echo "[LIFECYCLE] System shutting down"
                exit 0
                ;;
            *)
                echo "[LIFECYCLE] System state: $state"
                ;;
        esac

        sleep 10
    done
}

export -f set_state
export -f get_state
export -f verify_state
export -f health_check_loop

