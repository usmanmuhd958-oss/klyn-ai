#!/data/data/com.termux/files/usr/bin/bash
source kernel/types.sh

log "INFO" "KLYN Core Daemon started."

while true; do
  # Health Heartbeat generation
  echo "{\"status\": \"running\", \"last_heartbeat\": $(date +%s)}" > runtime/health.json
  sleep 5
done
