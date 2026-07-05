#!/usr/bin/env bash
set -Eeuo pipefail

boot() {
    source kernel/init.sh
    load_config
    recover_runtime
    load_plugins
}
