#!/data/data/com.termux/files/usr/bin/bash

EVENT_SCHEMA_VERSION="1.0"
ENGINE_LOG="runtime/logs/engine.log"

# Cikakken tsarin Enterprise Logging
log() {
  local level="$1"
  local msg="$2"
  echo "[$(date +'%H:%M:%S')] [$level] $msg" >> "$ENGINE_LOG"
}

# Tsarin tura saƙo na JSON Contract
emit_event() {
  local type="$1"
  local payload="$2"
  local ts=$(date +%s)

  local json_payload="{\"type\":\"$type\",\"payload\":\"$payload\",\"ts\":$ts,\"version\":\"$EVENT_SCHEMA_VERSION\"}"
  echo "$json_payload" >> runtime/events.log
  echo "$json_payload"
}
