#!/bin/bash

dispatch() {
  local job="$1"

  id=$(echo "$job" | jq -r '.id')
  type=$(echo "$job" | jq -r '.type')
  payload=$(echo "$job" | jq -r '.payload')

  echo "[DISPATCH] running job $id → $type"

  case "$type" in
    build) bash agents/coder.sh "$payload" ;;
    execute) bash agents/executor.sh "$payload" ;;
    review) bash agents/reviewer.sh "$payload" ;;
    plan|*) bash agents/planner.sh "$payload" ;;
  esac

  echo "[DISPATCH] finished $id"
}
