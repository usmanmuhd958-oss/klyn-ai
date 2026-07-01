#!/data/data/com.termux/files/usr/bin/bash
set -uo pipefail

QUEUE="runtime/v5/queue/jobs.jsonl"
LEDGER="runtime/v5/ledger/events.jsonl"
ROUTER="kernel/v5/router/router.sh"

touch "$QUEUE" "$LEDGER"

# Enterprise-Grade Robust Safe Logger using Native JQ Serialization
emit_ledger_event() {
  local status="$1"
  local type="$2"
  local payload="$3"
  local info="$4"
  local timestamp=$(date +%s%N)
  
  jq -n \
    --arg ts "$timestamp" \
    --arg st "$status" \
    --arg ty "$type" \
    --arg pl "$payload" \
    --arg mt "$info" \
    '{timestamp: $ts, status: $st, type: $ty, payload: $pl, meta: $mt}' >> "$LEDGER"
}

echo "[v5-PRO SCHEDULER] Advanced Enterprise Kernel Streaming..."

tail -f -n 0 "$QUEUE" | while read -r JOB; do
  [[ -z "$JOB" ]] && continue

  TYPE=$(echo "$JOB" | jq -r '.type' 2>/dev/null || echo "")
  PAYLOAD=$(echo "$JOB" | jq -r '.payload' 2>/dev/null || echo "")

  [[ -z "$TYPE" || "$TYPE" == "null" ]] && continue

  if [[ -f "$ROUTER" ]]; then
    source "$ROUTER"
    ROUTE_DECISION=$(route_task "$PAYLOAD" "$TYPE")
  else
    ROUTE_DECISION="default-worker"
  fi

  echo "[SCHEDULER] Dispatching '$TYPE' -> Target: $ROUTE_DECISION"
  emit_ledger_event "PROCESSING" "$TYPE" "$PAYLOAD" "Routed directly to $ROUTE_DECISION"

  (
    case "$TYPE" in
      build)   bash agents/coder.sh "$PAYLOAD" ;;
      execute) bash agents/executor.sh "$PAYLOAD" ;;
      review)  bash agents/reviewer.sh "$PAYLOAD" ;;
      plan)    bash agents/planner.sh "$PAYLOAD" ;;
      *)       echo "[WARN] Unknown job type: $TYPE" ; exit 1 ;;
    esac
    
    if [[ $? -eq 0 ]]; then
      emit_ledger_event "SUCCESS" "$TYPE" "$PAYLOAD" "Completed successfully on $ROUTE_DECISION"
    else
      emit_ledger_event "FAILED" "$TYPE" "$PAYLOAD" "Agent execution failed on $ROUTE_DECISION"
    fi
  ) &

done
