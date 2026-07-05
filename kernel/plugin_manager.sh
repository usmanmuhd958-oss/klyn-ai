#!/usr/bin/env bash
set -Eeuo pipefail

load_plugins() {
    [[ -d plugins ]] || return 0

    find plugins -type f -name '*.sh' | while read -r p; do
        echo "Loading: $p"
        source "$p"
    done
}
