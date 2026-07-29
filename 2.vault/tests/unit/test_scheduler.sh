#!/bin/bash
export PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$PROJECT_ROOT/kernel/src/core/scheduler.sh" 2>/dev/null || true
if declare -f schedule_job >/dev/null 2>&1; then
  echo "[PASS] Scheduler function exists"
else
  echo "[FAIL] Scheduler function missing"
  exit 1
fi
