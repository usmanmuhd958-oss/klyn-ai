#!/data/data/com.termux/files/usr/bin/bash
set +e

NODE_ID="${NODE_ID:-node-1}"

NODES="runtime/nodes.jsonl"

mkdir -p runtime

while true; do

  TIMESTAMP=$(date -Iseconds)

  jq -n \
    --arg node "$NODE_ID" \
    --arg ts "$TIMESTAMP" \
    '{
      node: $node,
      status: "alive",
      last_seen: $ts
    }' >> "$NODES.tmp"

  mv "$NODES.tmp" "$NODES"

  sleep 5

done
