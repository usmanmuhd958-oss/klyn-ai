#!/usr/bin/env bash
set -Eeuo pipefail

load_module() {
    local f="$1"

    [[ -f "$f" ]] || {
        echo "[WARN] Missing: $f"
        return 1
    }

    bash -n "$f" || {
        echo "[ERROR] Syntax error: $f"
        return 1
    }

    source "$f"
    echo "[OK] $f"
}
