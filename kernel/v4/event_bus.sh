#!/data/data/com.termux/files/usr/bin/bash

LEDGER="runtime/v4/ledger/events.jsonl"

emit_event() {
  local type="$1"
  local payload="$2"
  local id=$(date +%s%N)

  echo "{\"id\":\"$id\",\"type\":\"$type\",\"payload\":\"$payload\"}" >> "$LEDGER"

  echo "$id"
}

tail_events() {
  tail -n 20 "$LEDGER"
}
