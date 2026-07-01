#!/bin/bash
set -euo pipefail

BASE_DIR="$(pwd)"

SCHEDULER="core/scheduler.sh"
RECOVERY="core/recovery.sh"

LOG_FILE="runtime/logs/events.log"
PID_DIR="runtime/lock/pids"
LOCK_DIR="runtime/lock"

mkdir -p runtime/logs runtime/lock runtime/lock/pids runtime/ledger runtime/cluster

echo "[BOOT] Initializing KLYN AI OS v6..."

# ================================
# 1. CLEAN STALE STATE
# ================================
echo "[BOOT] Cleaning stale runtime state..."

rm -f runtime/lock/*.lock 2>/dev/null || true
rm -f runtime/lock/pids/*.pid 2>/dev/null || true
rm -f runtime/lock/pids/*.ts 2>/dev/null || true
rm -f runtime/lock/pids/*.status 2>/dev/null || true

touch "$LOG_FILE"

# ================================
# 2. START CORE PROCESSES
# ================================
echo "[BOOT] Launching kernel subsystems..."

# scheduler
bash "$SCHEDULER" >> "$LOG_FILE" 2>&1 &
SCHEDULER_PID=$!

# recovery
bash "$RECOVERY" >> "$LOG_FILE" 2>&1 &
RECOVERY_PID=$!

echo "[BOOT] Scheduler PID: $SCHEDULER_PID"
echo "[BOOT] Recovery PID : $RECOVERY_PID"

# ================================
# 3. GRACEFUL SHUTDOWN HANDLER
# ================================
shutdown() {
  echo ""
  echo "[BOOT] Shutdown signal received. Cleaning up..."

  if kill -0 "$SCHEDULER_PID" 2>/dev/null; then
    kill "$SCHEDULER_PID" 2>/dev/null || true
  fi

  if kill -0 "$RECOVERY_PID" 2>/dev/null; then
    kill "$RECOVERY_PID" 2>/dev/null || true
  fi

  rm -f runtime/lock/*.lock 2>/dev/null || true
  rm -f runtime/lock/pids/*.pid 2>/dev/null || true
  rm -f runtime/lock/pids/*.ts 2>/dev/null || true
  rm -f runtime/lock/pids/*.status 2>/dev/null || true

  echo "[BOOT] KLYN OS v6 shutdown complete."
  exit 0
}

trap shutdown SIGINT SIGTERM

# ================================
# 4. KEEP ALIVE LOOP
# ================================
echo "[BOOT] System online. Press Ctrl+C to stop."

while true; do
  sleep 5
done
