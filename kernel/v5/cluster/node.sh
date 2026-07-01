#!/bin/bash

set -euo pipefail

LEDGER="runtime/v5/ledger/jobs.jsonl"
LOG="runtime/v5/logs/node.log"

mkdir -p runtime/v5/logs

source kernel/v5/scheduler/dispatcher.sh

echo "[NODE] v5 worker online..."

while true; do

  # process ALL pending jobs (not just last line)
  while read -r job; do

    status=$(echo "$job" | jq -r '.status')

    if [[ "$status" == "pending" ]]; then

      id=$(echo "$job" | jq -r '.id')

      dispatch "$job"

      echo "$job" >> "$LOG"

    fi

  done < "$LEDGER"

  sleep 2
done
