#!/data/data/com.termux/files/usr/bin/bash

NODE_ID=$(hostname)
QUEUE="runtime/v4/ledger/jobs.jsonl"
STATE="runtime/v4/state/$NODE_ID.json"

mkdir -p runtime/v4/state

echo "[NODE v4] $NODE_ID online"

while true; do

  JOB=$(tail -n 1 "$QUEUE")

  if [[ -n "$JOB" ]]; then

    TYPE=$(echo "$JOB" | jq -r '.type')
    PAYLOAD=$(echo "$JOB" | jq -r '.payload')

    echo "[NODE:$NODE_ID] $TYPE"

    bash agents/"$TYPE"er.sh "$PAYLOAD" 2>/dev/null \
      || bash agents/planner.sh "$PAYLOAD"

  fi

  echo "{\"node\":\"$NODE_ID\",\"status\":\"alive\",\"ts\":$(date +%s)}" > "$STATE"

  sleep 2
done
