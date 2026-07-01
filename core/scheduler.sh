#!/bin/bash
set -euo pipefail

LEDGER="runtime/ledger/jobs.jsonl"
LOCK="runtime/lock/scheduler.lock"
PID_DIR="runtime/lock/pids"

mkdir -p runtime/{ledger,lock/pids,logs}

log() {
  echo "[SCHEDULER] $1"
}

acquire_lock() {
  [[ -f "$LOCK" ]] && return 1
  echo $$ > "$LOCK"
  return 0
}

release_lock() {
  rm -f "$LOCK"
}

spawn_job() {
  local line="$1"

  local id type payload
  id=$(echo "$line" | jq -r '.id')
  type=$(echo "$line" | jq -r '.type')
  payload=$(echo "$line" | jq -r '.payload')

  local pid_file="$PID_DIR/$id.pid"
  local ts_file="$PID_DIR/$id.ts"
  local status_file="$PID_DIR/$id.status"

  date +%s > "$ts_file"
  echo "running" > "$status_file"

  (
    set +e
    case "$type" in
      plan) bash agents/planner.sh "$payload" ;;
      code) bash agents/coder.sh "$payload" ;;
      review) bash agents/reviewer.sh "$payload" ;;
      execute) bash agents/executor.sh "$payload" ;;
      *) exit 1 ;;
    esac

    rc=$?

    if [[ $rc -eq 0 ]]; then
      echo "done" > "$status_file"
    else
      echo "failed" > "$status_file"
    fi

    exit $rc
  ) &

  real_pid=$!
  echo "$real_pid" > "$pid_file"

  log "job_spawned id=$id pid=$real_pid"
}

while true; do
  sleep 1

  acquire_lock || continue

  tmp=$(mktemp)

  while read -r line; do
    [[ -z "$line" ]] && continue

    status=$(echo "$line" | jq -r '.status')

    if [[ "$status" == "pending" ]]; then
      updated=$(echo "$line" | jq '.status="running"')
      spawn_job "$updated"
      echo "$updated" >> "$tmp"
    else
      echo "$line" >> "$tmp"
    fi

  done < "$LEDGER"

  mv "$tmp" "$LEDGER"
  release_lock

done
