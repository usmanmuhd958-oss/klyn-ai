#!/data/data/com.termux/files/usr/bin/bash

EVENT_DIR="runtime/events"

emit_event() {
  mkdir -p "$EVENT_DIR"

  local id=$(date +%s%N)
  local type="$1"
  local payload="$2"

  echo "{\"id\":\"$id\",\"type\":\"$type\",\"payload\":\"$payload\"}" \
    > "$EVENT_DIR/$id.json"

  echo "$id"
}
