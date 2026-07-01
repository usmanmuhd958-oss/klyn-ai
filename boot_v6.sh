#!/bin/bash
set -euo pipefail

echo "[BOOT] KLYN OS v6 Enterprise Bash Kernel Starting..."

BASE="runtime"
LEDGER="$BASE/ledger/jobs.jsonl"
NODES="$BASE/cluster/nodes.jsonl"
LOCK="$BASE/lock/scheduler.lock"
LOG="$BASE/logs/events.log"

mkdir -p runtime/{ledger,cluster,logs,lock}

touch "$LEDGER" "$NODES" "$LOG"

# -----------------------------
# SAFE LOGGER (NO jq)
# -----------------------------
log() {
  echo "{\"ts\":\"$(date +%s)\",\"module\":\"kernel\",\"level\":\"INFO\",\"msg\":\"$1\"}" >> "$LOG"
  echo "[KLYN] $1"
}

# -----------------------------
# SAFE JSON APPEND (NO jq)
# -----------------------------
submit_job() {
  local type="$1"
  local payload="$2"

  local id
  id="$(date +%s%N)"

  echo "{\"id\":\"$id\",\"type\":\"$type\",\"payload\":\"$payload\",\"status\":\"pending\",\"node\":\"local\"}" >> "$LEDGER"

  log "job submitted -> $type"
}

# -----------------------------
# LOCK SYSTEM
# -----------------------------
lock() {
  [[ -f "$LOCK" ]] && return 1
  echo $$ > "$LOCK"
  return 0
}

unlock() {
  rm -f "$LOCK" || true
}

# -----------------------------
# SAFE JSON PARSER (BASH ONLY)
# -----------------------------
get_field() {
  echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"
}

set_status() {
  echo "$1" | sed "s/\"status\":\"[^\"]*\"/\"status\":\"$2\"/"
}

# -----------------------------
# SCHEDULER
# -----------------------------
scheduler() {
  log "scheduler started"

  while true; do
    if lock; then

      tmp="$LEDGER.tmp"
      : > "$tmp"

      while IFS= read -r line; do
        [[ -z "$line" ]] && continue

        status=$(get_field "$line" "status")

        if [[ "$status" == "pending" ]]; then

          id=$(get_field "$line" "id")
          type=$(get_field "$line" "type")
          payload=$(get_field "$line" "payload")

          log "dispatch $type -> $id"

          updated=$(set_status "$line" "running")

          # EXECUTE AGENTS (safe bash routing)
          case "$type" in
            plan)
              agents/planner.sh "$payload"
              ;;
            code)
              agents/coder.sh "$payload"
              ;;
            review)
              agents/reviewer.sh "$payload"
              ;;
            execute)
              agents/executor.sh "$payload"
              ;;
            *)
              log "unknown job type"
              ;;
          esac

          updated=$(set_status "$updated" "done")
          echo "$updated" >> "$tmp"

        else
          echo "$line" >> "$tmp"
        fi

      done < "$LEDGER"

      mv "$tmp" "$LEDGER"
      unlock
    fi

    sleep 1
  done
}

# -----------------------------
# NODE HEARTBEAT SYSTEM
# -----------------------------
node_daemon() {
  log "node daemon started"

  while true; do
    ts="$(date +%s)"
    echo "{\"id\":\"node-1\",\"ts\":\"$ts\",\"status\":\"alive\"}" >> "$NODES"
    sleep 2
  done
}

# -----------------------------
# RECOVERY SYSTEM
# -----------------------------
recovery() {
  log "recovery scan started"

  touch "$LEDGER"

  tmp="$LEDGER.recover"
  : > "$tmp"

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    status=$(get_field "$line" "status")

    if [[ "$status" == "running" ]]; then
      line=$(set_status "$line" "pending")
    fi

    echo "$line" >> "$tmp"

  done < "$LEDGER"

  mv "$tmp" "$LEDGER"

  log "recovery complete"
}

# -----------------------------
# CLEAN SHUTDOWN
# -----------------------------
shutdown() {
  log "shutdown signal received"
  unlock
  exit 0
}

trap shutdown SIGINT SIGTERM

# -----------------------------
# BOOT SEQUENCE
# -----------------------------
recovery

node_daemon &
scheduler &

log "system online"

wait
