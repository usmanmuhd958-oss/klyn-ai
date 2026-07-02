#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# ================================
# KLYN OS v6 - ENTERPRISE BOOT KERNEL
# ================================

PROJECT_DIR="$HOME/klyn-ai-os"
RUNTIME_DIR="$PROJECT_DIR/runtime"
LOG_DIR="$PROJECT_DIR/logs"

PID_SCHED="$RUNTIME_DIR/scheduler.pid"
PID_BOOT="$RUNTIME_DIR/boot.pid"
SCHED_LOG="$LOG_DIR/scheduler.log"
BOOT_LOG="$LOG_DIR/boot.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [BOOT] [$1] $2"
}

cleanup() {
  log "SHUTDOWN" "Stopping all KLYN OS processes..."

  if [[ -f "$PID_SCHED" ]]; then
    kill "$(cat "$PID_SCHED")" 2>/dev/null || true
    rm -f "$PID_SCHED"
  fi

  rm -f "$PID_BOOT"
  log "OK" "Shutdown complete"
  exit 0
}

trap cleanup SIGINT SIGTERM

cd "$PROJECT_DIR"
mkdir -p runtime logs kernel

echo $$ > "$PID_BOOT"

log "START" "KLYN OS v6 initializing..."

# Validate core files
if [[ ! -f "kernel/scheduler.sh" ]]; then
  log "ERROR" "Missing kernel/scheduler.sh"
  exit 1
fi

chmod +x kernel/scheduler.sh || true

# Prevent duplicate scheduler
if [[ -f "$PID_SCHED" ]] && kill -0 "$(cat "$PID_SCHED")" 2>/dev/null; then
  log "WARN" "Scheduler already running"
else
  log "SPAWN" "Launching scheduler..."

  nohup ./kernel/scheduler.sh >> "$SCHED_LOG" 2>&1 &
  echo $! > "$PID_SCHED"
fi

log "OK" "System online"

# ================================
# WATCHDOG LOOP (SELF-HEALING KERNEL)
# ================================
FAIL_COUNT=0

while true; do

  if [[ ! -f "$PID_SCHED" ]] || ! kill -0 "$(cat "$PID_SCHED")" 2>/dev/null; then
    log "FAIL" "Scheduler crashed"

    ((FAIL_COUNT++))

    if [[ "$FAIL_COUNT" -ge 3 ]]; then
      log "CRITICAL" "Too many failures — stopping system"
      exit 1
    fi

    log "RECOVERY" "Restarting scheduler..."

    nohup ./kernel/scheduler.sh >> "$SCHED_LOG" 2>&1 &
    echo $! > "$PID_SCHED"
  fi

  sleep 5
done
