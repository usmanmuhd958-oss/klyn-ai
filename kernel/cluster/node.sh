#!/data/data/com.termux/files/usr/bin/bash

NODE_ID=$(hostname)
QUEUE="runtime/cluster/queue/global.jsonl"
HEART="runtime/cluster/heartbeats/$NODE_ID.json"

mkdir -p runtime/cluster/queue runtime/cluster/heartbeats

echo "[NODE] starting $NODE_ID"

while true; do

  JOB=$(tail -n 1 "$QUEUE")

  if [[ -n "$JOB" ]]; then

    TYPE=$(echo "$JOB" | jq -r '.type')
    PAYLOAD=$(echo "$JOB" | jq -r '.payload')

    echo "[NODE:$NODE_ID] executing $TYPE"

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
      *)
        bash agents/planner.sh "$PAYLOAD"
        ;;
    esac

  fi

  echo "{\"node\":\"$NODE_ID\",\"time\":$(date +%s),\"status\":\"alive\"}" > "$HEART"

  sleep 2
done
