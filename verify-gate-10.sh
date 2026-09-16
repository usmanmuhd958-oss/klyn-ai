#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_SHA="7998557eef00779bb2dd656c56dd05f38511ea03"
LOG="gate-10-${EXPECTED_SHA}.log"

exec > >(tee -a "$LOG") 2>&1

echo "===== KLYN GATE 10.0 LOCAL CERTIFICATION ====="
echo "UTC=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "EXPECTED_SHA=$EXPECTED_SHA"
echo "ACTUAL_SHA=$(git rev-parse HEAD)"

if [[ "$(git rev-parse HEAD)" != "$EXPECTED_SHA" ]]; then
  echo "FATAL: WRONG COMMIT"
  exit 1
fi

echo
echo "===== TOOLCHAIN ====="
node --version
pnpm --version
pnpm exec turbo --version

echo
echo "===== STEP 1: FROZEN INSTALL ====="
pnpm install --frozen-lockfile

echo
echo "===== STEP 2: TYPECHECK ====="
pnpm typecheck

echo
echo "===== STEP 3: BACKEND BUILD ====="
pnpm --filter @klyn/backend build

echo
echo "===== STEP 4: BACKEND TEST ====="
pnpm --filter @klyn/backend test

echo
echo "===== STEP 5: BACKEND LINT ====="
pnpm --filter @klyn/backend lint

echo
echo "===== STEP 6: FRONTEND / OBSOLETE PATH AUDIT ====="

if git grep -nE \
  'apps/studio|apps/studio/apps/web' \
  -- \
  vercel.json \
  vercel-ignore-build.sh \
  package.json \
  pnpm-workspace.yaml \
  apps/backend \
  packages
then
  echo "FATAL: OBSOLETE FRONTEND DEPLOYMENT REFERENCE FOUND"
  exit 1
else
  echo "FRONTEND_DEPLOYMENT_SCOPE=PASS"
fi

echo
echo "===== STEP 7: SERVERLESS ADAPTER AUDIT ====="

test -f apps/backend/api/index.ts

grep -n \
  'export default createApp' \
  apps/backend/api/index.ts

grep -n \
  'export function createApp' \
  apps/backend/src/app.ts

echo "SERVERLESS_ADAPTER=PASS"

echo
echo "===== TEST SUMMARY ====="

grep -E \
  '^(# )?(tests|pass|fail|cancelled|skipped|todo)' \
  "$LOG" || true

echo
echo "===== GATE 10.0 RESULT ====="
echo "GATE_10_0=PASS"

echo
echo "===== CERTIFICATION ARTIFACT ====="
echo "LOG=$PWD/$LOG"
