#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[BOOT] Microkernel initializing..."

BASE_DIR="$(pwd)"

mkdir -p "$BASE_DIR/runtime/queue"
mkdir -p "$BASE_DIR/runtime/events"
mkdir -p "$BASE_DIR/runtime/logs"
mkdir -p "$BASE_DIR/runtime/state"
mkdir -p "$BASE_DIR/agents"
mkdir -p "$BASE_DIR/kernel/core"

QUEUE="$BASE_DIR/runtime/queue/jobs.jsonl"
STATE="$BASE_DIR/runtime/state/system.json"

# SAFE STATE INIT
if [ ! -f "$STATE" ]; then
  echo '{"status":"starting","version":"microkernel-v1"}' > "$STATE"
fi

# SAFE QUEUE INIT
touch "$QUEUE"

echo "[BOOT] Environment ready"

exec bash kernel/core/daemon.sh
