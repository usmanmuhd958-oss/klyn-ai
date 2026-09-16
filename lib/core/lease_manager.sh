#!/usr/bin/env bash

# =============================================================================
# KLYN AI OS - Lease Manager (lib/core/lease_manager.sh)
# -----------------------------------------------------------------------------
# PURPOSE:
# This module provides distributed-safe resource locking (lease system)
# for the KLYN AI OS kernel.
#
# DESIGN PRINCIPLES:
# - Prevent race conditions across concurrent kernel processes
# - Provide deterministic ownership of shared resources
# - Use flock + file descriptors for atomic locking
# - Integrate with KLYN logging system
#
# EXPOSED API:
#   acquire_lease <resource_name>
#   release_lease <resource_name>
#
# LOCK STORAGE:
#   runtime/locks/<resource_name>.lock
# =============================================================================

set -euo pipefail

KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

LOCK_DIR="$KLYN_ROOT/runtime/locks"
mkdir -p "$LOCK_DIR"

# shellcheck source=/dev/null
source "$KLYN_ROOT/lib/utils/logger.sh"

# -----------------------------------------------------------------------------
# Internal: get lock file path
# -----------------------------------------------------------------------------
_lock_file() {
    echo "$LOCK_DIR/$1.lock"
}

# -----------------------------------------------------------------------------
# ACQUIRE LEASE
# -----------------------------------------------------------------------------
acquire_lease() {
    local resource="$1"
    local lock_file
    lock_file="$(_lock_file "$resource")"

    exec {fd}>"$lock_file"

    if flock -n "$fd"; then
        klyn_log "INFO" "Lease acquired for $resource (FD=$fd)"
        echo "$fd" > "$lock_file.fd"
        return 0
    else
        klyn_log "WARN" "Failed to acquire lease for $resource"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# RELEASE LEASE
# -----------------------------------------------------------------------------
release_lease() {
    local resource="$1"
    local lock_file
    lock_file="$(_lock_file "$resource")"

    if [[ -f "$lock_file.fd" ]]; then
        local fd
        fd=$(cat "$lock_file.fd")

        flock -u "$fd" || true
        eval "exec ${fd}>&-"

        rm -f "$lock_file.fd"

        klyn_log "INFO" "Lease released for $resource"
    else
        klyn_log "WARN" "No active lease found for $resource"
    fi
}

# Export functions for kernel-wide usage
export -f acquire_lease
export -f release_lease

