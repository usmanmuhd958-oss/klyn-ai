#!/data/data/com.termux/files/usr/bin/bash

set -e

BASE_DIR="$(pwd)"
EVENT_LOG="$BASE_DIR/runtime/logs/kernel.log"
EVENT_STORE="$BASE_DIR/runtime/events/events.db"

mkdir -p runtime/logs runtime/events runtime/state

log() {
  echo "[$(date '+%H:%M:%S')] [$1] $2" | tee -a "$EVENT_LOG"
}

emit_event() {
  local type="$1"
  local payload="$2"

  jq -n \
    --arg type "$type" \
    --arg payload "$payload" \
    --arg ts "$(date +%s)" \
    '{type:$type, payload:$payload, ts:$ts}'
}

route() {
  local event="$1"
  local type
  type=$(echo "$event" | jq -r '.type')
  local payload
  payload=$(echo "$event" | jq -r '.payload')

  log "ROUTER" "type=$type payload=$payload"

  case "$type" in
    build)
      bash agents/coder.sh "$payload"
      ;;
    review)
      bash agents/reviewer.sh "$payload"
      ;;
    execute)
      bash agents/executor.sh "$payload"
      ;;
    plan|*)
      bash agents/planner.sh "$payload"
      ;;
  esac
}

run_kernel() {
  local input="$1"

  log "INFO" "Kernel received: $input"

  local event
  event=$(emit_event "plan" "$input")

  echo "$event" >> "$EVENT_STORE"

  route "$event"

  log "INFO" "Kernel cycle complete"
}

run_kernel "$1"
