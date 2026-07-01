#!/data/data/com.termux/files/usr/bin/bash

echo "[WATCHDOG] active"

while true; do

  echo "{\"time\":$(date +%s),\"status\":\"alive\"}" \
    > runtime/state/heartbeat.json

  # restart kernel if scheduler dies
  if ! pgrep -f scheduler.sh >/dev/null; then
    echo "[WATCHDOG] scheduler crashed → restarting"
    bash kernel/scheduler.sh &
  fi

  sleep 5
done
