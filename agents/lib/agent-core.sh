#!/data/data/com.termux/files/usr/bin/bash
source kernel/types.sh

load_event() {
  echo "$1" | jq .
}

respond() {
  local status="$1"
  local output="$2"
  echo "{\"status\":\"$status\",\"result\":\"$output\"}"
}
