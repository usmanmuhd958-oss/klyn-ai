#!/bin/bash

set -euo pipefail

QUEUE="runtime/queue/jobs.jsonl"
POINTER="runtime/state/queue.pointer"

source kernel/scheduler/dispatcher.sh

mkdir -p runtime/{queue,state,logs}

touch "$QUEUE"
[[ ! -f "$POINTER" ]] && echo "0" > "$POINTER"

echo "[KERNEL] v4 architecture kernel starting..."

while true; do

  INDEX=$(cat "$POINTER")
  JOB=$(sed -n "${INDEX}p" "$QUEUE")

  if [[ -n "$JOB" ]]; then

    echo "[KERNEL] job #$INDEX received"

    dispatch_job "$JOB"

    echo "[LOG] $JOB" >> runtime/logs/kernel.log

    INDEX=$((INDEX + 1))
    echo "$INDEX" > "$POINTER"

  fi

  sleep 1
done
