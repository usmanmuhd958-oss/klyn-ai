#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

EVENT_BUS="$ROOT/packages/core-runtime/src/EventBus.ts"
INDEX="$ROOT/packages/core-runtime/src/index.ts"

echo "================================="
echo " KLYN CORE RUNTIME EVENT BUS INTEGRATOR"
echo "================================="

if [ ! -f "$EVENT_BUS" ]; then
  echo "ERROR: EventBus.ts not found"
  exit 1
fi

EXPORT_LINE='export * from "./EventBus.js";'

if grep -Fxq "$EXPORT_LINE" "$INDEX"; then
  echo "[OK] EventBus export already exists"
else
  echo "$EXPORT_LINE" >> "$INDEX"
  echo "[OK] EventBus export added"
fi

echo
echo "Verification:"
grep "EventBus" "$INDEX"

echo
echo "================================="
echo " EVENT BUS INTEGRATION COMPLETE"
echo "================================="
