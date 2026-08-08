#!/bin/bash
PLUGIN_DIR="${PROJECT_ROOT:-..}/plugins/installed"

load_plugin() {
    local plugin_name="$1"
    if [ -f "$PLUGIN_DIR/$plugin_name/init.sh" ]; then
        source "$PLUGIN_DIR/$plugin_name/init.sh"
        echo "[PLUGIN] Loaded $plugin_name"
    else
        echo "[PLUGIN] $plugin_name not found"
    fi
}
