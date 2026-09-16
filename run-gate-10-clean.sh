#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_SHA="7998557eef00779bb2dd656c56dd05f38511ea03"
LOG_FILE="gate-10-clean-telemetry.log"

rm -f "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=================================================="
echo "   KLYN ENGINE - GATE 10.0 CLEAN CERTIFICATION   "
echo "=================================================="
echo "UTC_TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "EXPECTED_SHA=$EXPECTED_SHA"
echo "ACTUAL_SHA=$(git rev-parse HEAD)"

if [[ "$(git rev-parse HEAD)" != "$EXPECTED_SHA" ]]; then
  echo "FATAL: WRONG COMMIT SHA AT HEAD"
  exit 1
fi

echo ""
echo "--- [1/5] APPLYING CLEAN APP.TS FIX ---"
node fix-app.js

echo "HEAD OF apps/backend/src/app.ts:"
head -n 5 apps/backend/src/app.ts

echo ""
echo "--- [2/5] EXECUTE DIRECT TYPECHECK ---"
pnpm --filter @klyn/backend exec tsc --noEmit
echo "TYPECHECK_EXIT_CODE=$?"

echo ""
echo "--- [3/5] EXECUTE BACKEND BUILD ---"
pnpm --filter @klyn/backend run build
echo "BUILD_EXIT_CODE=$?"

echo ""
echo "--- [4/5] EXECUTE BACKEND TESTS ---"
pnpm --filter @klyn/backend run test
echo "TEST_EXIT_CODE=$?"

echo ""
echo "--- [5/5] EXECUTE BACKEND LINT ---"
pnpm --filter @klyn/backend run lint
echo "LINT_EXIT_CODE=$?"

echo ""
echo "=================================================="
echo "          RAW TELEMETRY CAPTURE COMPLETE         "
echo "=================================================="
