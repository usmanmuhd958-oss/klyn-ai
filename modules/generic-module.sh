#!/usr/bin/env bash
set -euo pipefail

# KLYN AI OS - Robust Module Template
KLYN_ROOT="${KLYN_ROOT:-$HOME/klyn-ai-os}"
MODULE_NAME="generic-module"
LOCK_FILE="$KLYN_ROOT/runtime/locks/${MODULE_NAME}.lock"
LOG_FILE="$KLYN_ROOT/runtime/logs/system.log"

log() {
  printf "[%s] [%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$MODULE_NAME" "$1" >> "$LOG_FILE"
}

cleanup() {
  rm -f "$LOCK_FILE" 2>/dev/null || true
}
trap cleanup EXIT

# Locking Mechanism: Safe and robust
if ! flock -n "$LOCK_FILE" -c "
    log 'Module execution started'
    # YOUR LOGIC GOES HERE
    echo 'Operation successful'
    log 'Module execution completed'
"; then
    log "Another instance is running. Exiting."
    exit 0
fi

