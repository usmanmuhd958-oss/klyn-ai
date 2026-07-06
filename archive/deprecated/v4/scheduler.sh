#!/data/data/com.termux/files/usr/bin/bash

QUEUE="runtime/v4/ledger/jobs.jsonl"

echo "[SCHEDULER v4] starting..."

while true; do

  JOB=$(tail -n 1 "$QUEUE")

  [[ -z "$JOB" ]] && sleep 1 && continue

  TYPE=$(echo "$JOB" | jq -r '.type')
  PAYLOAD=$(echo "$JOB" | jq -r '.payload')

  echo "[SCHEDULER] dispatch $TYPE"

  case "$TYPE" in
    build)
      bash agents/coder.sh "$PAYLOAD"
      ;;
    execute)
      bash agents/executor.sh "$PAYLOAD"
      ;;
    review)
      bash agents/reviewer.sh "$PAYLOAD"
      ;;
    plan)
      bash agents/planner.sh "$PAYLOAD"
      ;;
  esac

  sleep 1
done
