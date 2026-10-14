#!/usr/bin/env bash
# Stable underscore spelling used by Step 5; retain the reviewed legacy entry point.
set -Eeuo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$script_dir/qualify-native-linux.sh" "$@"
