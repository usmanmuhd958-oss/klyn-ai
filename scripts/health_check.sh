#!/bin/bash
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PASS=0; FAIL=0

log() {
    if [ "$1" = "OK" ]; then echo "[PASS] $2"; ((PASS++)); else echo "[FAIL] $2"; ((FAIL++)); fi
}

[ -d "$PROJECT_ROOT/runtime" ] && log OK "Runtime directory" || log FAIL "Runtime directory missing"

if pgrep -f "node api/server.js" >/dev/null 2>&1; then
    log OK "API running"
else
    log FAIL "API not running"
fi

if node "$PROJECT_ROOT/kernel/src/services/state_engine.js" health >/dev/null 2>&1; then
    log OK "State engine"
else
    log FAIL "State engine offline"
fi

echo "==========="
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
