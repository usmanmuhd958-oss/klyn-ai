#!/bin/bash
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PASS=0; FAIL=0

log() { if [ "$1" = "OK" ]; then echo "[PASS] $2"; ((PASS++)); else echo "[FAIL] $2"; ((FAIL++)); fi; }

[ -d "$PROJECT_ROOT/runtime" ] && log OK "Runtime" || log FAIL "Runtime missing"
[ -f "$PROJECT_ROOT/runtime/pids/api.pid" ] && kill -0 $(cat "$PROJECT_ROOT/runtime/pids/api.pid") 2>/dev/null && log OK "API running" || log FAIL "API not running"
[ -d "$PROJECT_ROOT/runtime/queue" ] && log OK "Job queue" || log FAIL "Job queue missing"

if node "$PROJECT_ROOT/kernel/src/services/state_engine.js" health 2>/dev/null; then
    log OK "State engine"
else
    log FAIL "State engine offline"
fi

echo "==========="
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
