#!/usr/bin/env bash
set -Eeuo pipefail

require_file() {
    [[ -f "$1" ]] || {
        echo "Missing: $1"
        return 1
    }
}
