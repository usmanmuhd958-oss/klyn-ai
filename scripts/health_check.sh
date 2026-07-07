#!/bin/bash
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PASS=0; FAIL=0
log() {
    if [ "$1" = "OK" ]; then echo "[PASS] $2"; ((PASS++)); else echo "[FAIL] $2"; ((FAIL++)); fi
}
pgrep -f "node api/server.js" >/dev/null 2>&1 && log OK "API running" || log FAIL "API not running"
node "$PROJECT_ROOT/kernel/src/services/state_engine.js" health >/dev/null 2>&1 && log OK "State engine" || log FAIL "State engine offline"
echo "==========="
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
