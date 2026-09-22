#!/usr/bin/env bash
set -euo pipefail

echo "=== 1. Linking workspace packages (Strict Offline / No Verification) ==="
pnpm install --offline --config.verify-deps-before-run=false || \
pnpm install --prefer-offline --config.verify-deps-before-run=false || {
  echo "Offline linking failed. Running pnpm without network verifications..."
  pnpm install --config.verify-deps-before-run=false
}

echo "=== 2. Cleaning stale build output ==="
rm -rf packages/autonomy/dist packages/ai-engine/dist

echo "=== 3. Building @klyn/autonomy ==="
pnpm --filter @klyn/autonomy run build

echo "=== 4. Testing @klyn/autonomy ==="
pnpm --filter @klyn/autonomy run test

echo "=== 5. Building @klyn/ai-engine ==="
pnpm --filter @klyn/ai-engine run build

echo "=== 6. Testing @klyn/ai-engine ==="
pnpm --filter @klyn/ai-engine run test

echo "=== Build and Test Completed Successfully! ==="
