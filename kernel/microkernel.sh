#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

ROOT="$(pwd)"
RUNTIME="$ROOT/runtime"
QUEUE="$RUNTIME/queue/jobs.jsonl"
EVENTS="$RUNTIME/events"

mkdir -p "$RUNTIME/queue" "$RUNTIME/events" "$RUNTIME/state" "$RUNTIME/logs"

echo "[MICROKERNEL] booting enterprise AI kernel..."

# -------------------------
# RECOVERY SYSTEM
# -------------------------
recover() {
  echo "[RECOVERY] checking system state..."

  [[ ! -f "$QUEUE" ]] && touch "$QUEUE"

  echo "[RECOVERY] queue ready"
}

# -------------------------
# EVENT DISPATCHER
# -------------------------
dispatch() {
  local job="$1"

  local type=$(echo "$job" | jq -r '.type')
  local payload=$(echo "$job" | jq -r '.payload')

  echo "[DISPATCH] type=$type payload=$payload"

  case "$type" in
    build)
      bash agents/coder.sh "$payload"
      ;;
    execute)
      bash agents/executor.sh "$payload"
      ;;
    review)
      bash agents/reviewer.sh "$payload"
      ;;
    *)
      bash agents/planner.sh "$payload"
      ;;
  esac
}

# -------------------------
# SCHEDULER LOOP
# -------------------------
scheduler_loop() {
  while true; do

    JOB=$(tail -n 1 "$QUEUE")

    if [[ -n "$JOB" ]]; then
      dispatch "$JOB"
    fi

    sleep 1
  done
}

# -------------------------
# WATCHDOG
# -------------------------
watchdog() {
  while true; do
    echo "{\"time\":$(date +%s),\"status\":\"alive\"}" > "$RUNTIME/state/heartbeat.json"
    sleep 5
  done
}

# -------------------------
# BOOT SEQUENCE
# -------------------------
recover

watchdog &

echo "[MICROKERNEL] entering infinite system loop..."

scheduler_loop
