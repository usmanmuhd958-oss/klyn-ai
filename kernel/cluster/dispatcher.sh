#!/data/data/com.termux/files/usr/bin/bash

QUEUE="runtime/cluster/queue/global.jsonl"
NODES="runtime/cluster/nodes.jsonl"

echo "[DISPATCHER] starting global router"

get_node() {
  tail -n 1 "$NODES" | jq -r '.id'
}

while true; do

  JOB=$(tail -n 1 "$QUEUE")

  if [[ -n "$JOB" ]]; then

    NODE=$(get_node)

    TYPE=$(echo "$JOB" | jq -r '.type')
    PAYLOAD=$(echo "$JOB" | jq -r '.payload')

    echo "[DISPATCH] sending $TYPE → $NODE"

    # local simulation (later SSH upgrade)
    bash kernel/cluster/node.sh &
  fi

  sleep 2
done
