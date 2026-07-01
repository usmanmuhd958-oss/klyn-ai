#!/bin/bash
set -euo pipefail

LEDGER="runtime/ledger/jobs.jsonl"
PID_DIR="runtime/lock/pids"

mkdir -p runtime/{ledger,lock/pids,logs}

log() {
  echo "[RECOVERY] $1"
}

cleanup() {
  local id="$1"
  rm -f "$PID_DIR/$id.pid"
  rm -f "$PID_DIR/$id.ts"
  rm -f "$PID_DIR/$id.status"
}

while true; do
  sleep 2

  now=$(date +%s)
  tmp=$(mktemp)

  while read -r line; do
    [[ -z "$line" ]] && continue

    id=$(echo "$line" | jq -r '.id')
    status=$(echo "$line" | jq -r '.status')

    pid_file="$PID_DIR/$id.pid"
    ts_file="$PID_DIR/$id.ts"
    status_file="$PID_DIR/$id.status"

    updated_line="$line"

    if [[ "$status" == "running" ]]; then

      # missing tracking → safe reset
      if [[ ! -f "$pid_file" || ! -f "$ts_file" || ! -f "$status_file" ]]; then
        updated_line=$(echo "$line" | jq '.status="pending"')
        echo "$updated_line" >> "$tmp"
        continue
      fi

      pid=$(cat "$pid_file")
      start=$(cat "$ts_file")

      runtime=$((now - start))

      # PID still alive
      if kill -0 "$pid" 2>/dev/null; then

        # TIMEOUT GUARD
        if (( runtime > 120 )); then
          log "TIMEOUT kill id=$id pid=$pid runtime=${runtime}s"
          kill -9 "$pid" 2>/dev/null || true

          updated_line=$(echo "$line" | jq '.status="failed"')
          cleanup "$id"
        fi

        echo "$updated_line" >> "$tmp"
        continue
      fi

      # PID DEAD → check final state
      if [[ -f "$status_file" ]]; then
        state=$(cat "$status_file")

        if [[ "$state" == "done" ]]; then
          updated_line=$(echo "$line" | jq '.status="done"')
          cleanup "$id"

        elif [[ "$state" == "failed" ]]; then
          updated_line=$(echo "$line" | jq '.status="failed"')
          cleanup "$id"

        else
          updated_line=$(echo "$line" | jq '.status="pending"')
          cleanup "$id"
        fi
      fi
    fi

    echo "$updated_line" >> "$tmp"

  done < "$LEDGER"

  mv "$tmp" "$LEDGER"

done
