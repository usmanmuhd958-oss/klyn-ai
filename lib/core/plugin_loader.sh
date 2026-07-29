#!/usr/bin/env bash

# =============================================================================
# KLYN AI OS - Plugin Loader (lib/core/plugin_loader.sh)
# -----------------------------------------------------------------------------
# PURPOSE:
# Dynamically loads kernel plugins at runtime without modifying core kernel.
#
# DESIGN GOALS:
# - Modular extensibility (hot-pluggable architecture)
# - Safe plugin isolation (failure does not crash OS)
# - Metadata-driven validation
# - Deterministic boot-time loading
# =============================================================================

set -euo pipefail

KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

PLUGIN_DIR="$KLYN_ROOT/kernel/modules"

# -----------------------------------------------------------------------------
# Validate plugin metadata
# -----------------------------------------------------------------------------
validate_plugin() {
    local file="$1"

    grep -q "^# PLUGIN_NAME:" "$file" || return 1
    grep -q "^# PLUGIN_VERSION:" "$file" || return 1
    grep -q "^# PLUGIN_TYPE:" "$file" || return 1

    return 0
}

# -----------------------------------------------------------------------------
# Load single plugin safely
# -----------------------------------------------------------------------------
load_plugin() {
    local plugin_file="$1"

    if [[ ! -f "$plugin_file" ]]; then
        echo "[PLUGIN LOADER] Missing file: $plugin_file"
        return 1
    fi

    if ! validate_plugin "$plugin_file"; then
        echo "[PLUGIN LOADER] Invalid metadata: $plugin_file"
        return 1
    fi

    # Safe sourcing (prevents kernel crash)
    if ! source "$plugin_file"; then
        echo "[PLUGIN LOADER] Failed to load plugin: $plugin_file"
        return 1
    fi

    echo "[PLUGIN LOADER] Loaded: $plugin_file"
}

# -----------------------------------------------------------------------------
# Load all plugins at boot
# -----------------------------------------------------------------------------
load_all_plugins() {
    echo "[PLUGIN LOADER] Scanning plugins in $PLUGIN_DIR"

    if [[ ! -d "$PLUGIN_DIR" ]]; then
        echo "[PLUGIN LOADER] No plugin directory found"
        return 1
    fi

    for plugin in "$PLUGIN_DIR"/*.sh; do
        [[ -e "$plugin" ]] || continue

        if ! load_plugin "$plugin"; then
            echo "[PLUGIN LOADER] WARNING: Skipping broken plugin: $plugin"
            continue
        fi
    done
}

export -f load_plugin
export -f load_all_plugins

