#!/bin/bash

QUEUE="runtime/queue/jobs.jsonl"
POINTER="runtime/state/queue.pointer"

dispatch_job() {
  local job="$1"

  type=$(echo "$job" | jq -r '.type')
  payload=$(echo "$job" | jq -r '.payload')

  case "$type" in
    build) bash agents/coder.sh "$payload" ;;
    execute) bash agents/executor.sh "$payload" ;;
    review) bash agents/reviewer.sh "$payload" ;;
    plan|*) bash agents/planner.sh "$payload" ;;
  esac
}
