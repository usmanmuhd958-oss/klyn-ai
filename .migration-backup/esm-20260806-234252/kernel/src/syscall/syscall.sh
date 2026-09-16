#!/bin/bash

create_job() {
  local type="$1"
  local payload="$2"

  mkdir -p runtime/queue

  echo "{\"type\":\"$type\",\"payload\":\"$payload\"}" >> runtime/queue/jobs.jsonl

  echo "[SYSCALL] job created"
}

get_state() {
  cat runtime/state/system.json
}
