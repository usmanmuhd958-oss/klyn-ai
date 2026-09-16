#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_SHA="7998557eef00779bb2dd656c56dd05f38511ea03"
LOG="gate-10-${EXPECTED_SHA}.log"
APP_FILE="apps/backend/src/app.ts"

exec > >(tee -a "$LOG") 2>&1

echo "===== KLYN GATE 10.0 AUTOMATED REMEDIATION & CERTIFICATION ====="
echo "UTC=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "EXPECTED_SHA=$EXPECTED_SHA"
echo "ACTUAL_SHA=$(git rev-parse HEAD)"

if [[ "$(git rev-parse HEAD)" != "$EXPECTED_SHA" ]]; then
  echo "FATAL: WRONG COMMIT"
  exit 1
fi

echo
echo "===== FIXING APP.TS IMPORTS AND RETURN TYPE ====="
node -e '
const fs = require("fs");
const file = process.argv[1];
let code = fs.readFileSync(file, "utf8");

// Reset express imports cleanly
code = code.replace(/import\s+express\s*(?:,\s*\{[^}]*\}|\{[^}]*\})?\s*from\s*["\']express["\'];?/g, "");
code = `import express, { type Express } from "express";\n` + code.trimStart();

// Ensure createApp has explicit Express return type
code = code.replace(/export\s+function\s+createApp\s*\(\s*\)\s*(?::\s*Express)?/g, "export function createApp(): Express");

fs.writeFileSync(file, code);
' "$APP_FILE"

echo "Updated $APP_FILE:"
head -n 10 "$APP_FILE"

echo
echo "===== TOOLCHAIN ====="
node --version
pnpm --version

echo
echo "===== STEP 1: DIRECT TYPECHECK ====="
pnpm --filter @klyn/backend exec tsc --noEmit

echo
echo "===== STEP 2: DIRECT BACKEND BUILD ====="
pnpm --filter @klyn/backend run build

echo
echo "===== STEP 3: DIRECT BACKEND TEST ====="
pnpm --filter @klyn/backend run test

echo
echo "===== STEP 4: DIRECT BACKEND LINT ====="
pnpm --filter @klyn/backend run lint

echo
echo "===== GATE 10.0 DIRECT RESULT ====="
echo "GATE_10_0=PASS"
