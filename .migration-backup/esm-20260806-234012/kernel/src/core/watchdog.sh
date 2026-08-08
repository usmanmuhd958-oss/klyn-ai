#!/usr/bin/env bash

while true; do
  if ! pgrep -f "kernel/scheduler.sh" >/dev/null; then
    echo "[WATCHDOG] restarting scheduler..."
    bash kernel/scheduler.sh &
  fi
  sleep 5
done
