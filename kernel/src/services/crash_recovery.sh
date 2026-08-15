#!/bin/bash
PROJECT_ROOT="${PROJECT_ROOT:-${HOME}/klyn-ai-os}"
# api/gateway.ts (8000), api/metrics.ts (9090) and the original server were
# consolidated into the single unified entrypoint klyn_server.js (Phase 2).
SERVICES=(
  "node api/server.js:api"
  "node klyn_server.js:gateway"
  "node apps/web/admin.js:admin"
  "node dashboard/web_editor.js:web_editor"
  "node services/collaboration/server.js:collaboration"
)

while true; do
  for svc in "${SERVICES[@]}"; do
    CMD=$(echo "$svc" | cut -d: -f1)
    NAME=$(echo "$svc" | cut -d: -f2)
    if ! pgrep -f "$CMD" >/dev/null; then
      echo "[$(date)] $NAME died, restarting..." >> runtime/logs/crash_recovery.log
      cd "$PROJECT_ROOT"
      nohup $CMD > "runtime/logs/${NAME}.log" 2>&1 &
    fi
  done
  sleep 10
done
