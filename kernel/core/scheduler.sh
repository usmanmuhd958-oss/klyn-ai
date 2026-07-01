#!/bin/bash

QUEUE="runtime/queue/jobs.jsonl"
mkdir -p runtime/queue
touch "$QUEUE"

echo "[SCHEDULER] running..."

while true; do
  while read -r job; do
    [[ -z "$job" ]] && continue

    type=$(echo "$job" | jq -r '.type // empty')
    payload=$(echo "$job" | jq -r '.payload // empty')

    echo "[SCHEDULER] $type → $payload"

    case "$type" in
      build) bash agents/coder.sh "$payload" ;;
      execute) bash agents/executor.sh "$payload" ;;
      review) bash agents/reviewer.sh "$payload" ;;
      *) bash agents/planner.sh "$payload" ;;
    esac

  done < "$QUEUE"

  sleep 1
done
