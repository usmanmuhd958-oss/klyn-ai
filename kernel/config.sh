#!/usr/bin/env bash
set -Eeuo pipefail

load_config() {
    [[ -f config/default.env ]] &&
        source config/default.env
}
