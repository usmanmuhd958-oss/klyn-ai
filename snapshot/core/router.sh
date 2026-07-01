#!/data/data/com.termux/files/usr/bin/bash
source kernel/types.sh

route_event() {
  local event_json="$1"
  
  # Deterministic schema parsing via jq
  local type=$(echo "$event_json" | jq -r '.type' 2>/dev/null)

  log "INFO" "Routing event type: '$type'"

  case "$type" in
    "build"|"code_gen")
        bash agents/coder.sh "$event_json" ;;
    "review")
        bash agents/reviewer.sh "$event_json" ;;
    "execute")
        bash agents/executor.sh "$event_json" ;;
    *)
        echo "[PLANNER] Fallback triggered. Raw JSON: $event_json"
        bash agents/planner.sh "$event_json" ;;
  esac
}
