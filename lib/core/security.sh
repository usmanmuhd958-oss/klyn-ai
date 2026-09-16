#!/usr/bin/env bash

# =============================================================================
# KLYN AI OS - Security Module (lib/core/security.sh)
# -----------------------------------------------------------------------------
# PURPOSE:
# Provides Role-Based Access Control (RBAC) and basic credential hashing
# for KLYN AI OS kernel and CLI subsystems.
#
# DESIGN GOALS:
# - Enforce least privilege execution model
# - Provide simple role validation system
# - Support modular sourcing across kernel tools
# - Lightweight SHA256-based password hashing
#
# STORAGE LAYER:
#   runtime/users/<username>.role
#   runtime/users/<username>.hash
# =============================================================================

set -euo pipefail

KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

USER_DIR="$KLYN_ROOT/runtime/users"

mkdir -p "$USER_DIR"

# -----------------------------------------------------------------------------
# HASH PASSWORD (SHA256)
# -----------------------------------------------------------------------------
hash_password() {
    local password="$1"
    echo -n "$password" | sha256sum | awk '{print $1}'
}

# -----------------------------------------------------------------------------
# GET USER ROLE
# -----------------------------------------------------------------------------
_get_user_role() {
    local username="$1"
    local role_file="$USER_DIR/${username}.role"

    if [[ -f "$role_file" ]]; then
        cat "$role_file"
    else
        echo "Guest"
    fi
}

# -----------------------------------------------------------------------------
# CHECK PERMISSION
# Usage:
#   check_permission "Admin"
# -----------------------------------------------------------------------------
check_permission() {
    local role_required="$1"

    if [[ -z "${KLYN_USER:-}" ]]; then
        echo "ACCESS_DENIED: No active user session"
        return 1
    fi

    local user_role
    user_role=$(_get_user_role "$KLYN_USER")

    # Role hierarchy (simple deterministic model)
    case "$user_role" in
        Admin)
            return 0
            ;;
        User)
            if [[ "$role_required" == "User" ]]; then
                return 0
            else
                echo "ACCESS_DENIED: User lacks privilege (required=$role_required, actual=$user_role)"
                return 1
            fi
            ;;
        Guest)
            echo "ACCESS_DENIED: Guest has no privileges"
            return 1
            ;;
        *)
            echo "ACCESS_DENIED: Unknown role"
            return 1
            ;;
    esac
}

# Export functions for kernel-wide usage
export -f check_permission
export -f hash_password

