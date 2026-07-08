#!/bin/bash
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
echo "🧪 Running unit tests..."
for t in tests/unit/test_*.sh; do
  if bash "$t" 2>/dev/null; then
    ((PASS++))
  else
    ((FAIL++))
  fi
done
echo "==========="
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
