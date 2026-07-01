#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$BASE_DIR/runtime"
LOG_DIR="$RUNTIME_DIR/logs"

PID_FILE="$RUNTIME_DIR/daemon.pid"
LOG_FILE="$LOG_DIR/daemon.log"
KERNEL_CORE="$BASE_DIR/kernel/v6/core/master.py"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [$1] $2" >> "$LOG_FILE"
}

cleanup() {
  log "INFO" "Shutdown signal received"
  rm -f "$PID_FILE"
  exit 0
}

trap cleanup SIGINT SIGTERM

health_check() {
  log "INFO" "Health check running"

  [[ -f "$KERNEL_CORE" ]] || {
    log "ERROR" "Missing kernel core"
    return 1
  }

  python "$KERNEL_CORE" --health >/dev/null 2>&1 || {
    log "ERROR" "Kernel health failed"
    return 1
  }

  log "INFO" "Health check OK"
}

log "INFO" "Daemon starting"

health_check || {
  log "ERROR" "Startup aborted"
  exit 2
}

echo $$ > "$PID_FILE"
log "INFO" "PID $$ registered"

while true; do
  if [[ -f "$RUNTIME_DIR/state/kernel.state" ]]; then
    log "INFO" "Kernel OK"
  else
    log "WARN" "Kernel state missing"
  fi

  sleep 5
done
