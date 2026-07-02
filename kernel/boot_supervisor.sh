#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# ==============================
# KLYN AI OS - SUPERVISOR CORE
# ==============================

BASE_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"

RUNTIME_DIR="$BASE_DIR/runtime"
STATE_DIR="$RUNTIME_DIR/state"
LOG_DIR="$RUNTIME_DIR/logs"

SCHEDULER="$BASE_DIR/kernel/scheduler/scheduler.sh"
RECOVERY="$BASE_DIR/kernel/v6/recovery/recovery.sh"

PID_FILE="$STATE_DIR/scheduler.pid"
STATE_FILE="$STATE_DIR/system.state"
LOG_FILE="$LOG_DIR/supervisor.log"

mkdir -p "$STATE_DIR" "$LOG_DIR"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [SUPERVISOR] $*" | tee -a "$LOG_FILE"
}

health_check() {
  [[ -f "$STATE_FILE" ]]
}

start_scheduler() {
  if [[ -f "$SCHEDULER" ]]; then
    log "Starting scheduler..."
    bash "$SCHEDULER" &
    echo $! > "$PID_FILE"
    log "Scheduler PID: $(cat "$PID_FILE")"
  else
    log "CRITICAL: Scheduler not found at $SCHEDULER"
    return 1
  fi
}

stop_scheduler() {
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE" || true)"
    if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
      log "Stopping scheduler PID $PID"
      kill "$PID" || true
    fi
    rm -f "$PID_FILE"
  fi
}

recover() {
  if [[ -f "$RECOVERY" ]]; then
    log "Running recovery module..."
    bash "$RECOVERY"
  else
    log "CRITICAL: Recovery module missing at $RECOVERY"
  fi
}

main_loop() {
  log "=== SUPERVISOR BOOT ==="

  start_scheduler || exit 1

  while true; do
    sleep 5

    if ! health_check; then
      log "HEALTH CHECK FAILED"

      stop_scheduler
      recover

      log "Restarting scheduler..."
      start_scheduler || log "FAILED to restart scheduler"
    fi
  done
}

main_loop
