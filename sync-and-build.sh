#!/usr/bin/env bash
set -euo pipefail

BRANCH="phase-4-5-hardening"
REMOTE="origin"

echo "=== 1. Fetching origin remote directly ==="
git fetch "$REMOTE" "$BRANCH"

echo "=== 2. Switching to ${BRANCH} ==="
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git switch "$BRANCH"
else
  git checkout -b "$BRANCH" FETCH_HEAD
fi

echo "=== 3. Resetting branch head to latest remote commit ==="
git reset --hard FETCH_HEAD

echo "=== 4. Installing workspace dependencies ==="
pnpm install --frozen-lockfile

echo "=== 5. Building @klyn/autonomy first ==="
pnpm --filter @klyn/autonomy run build

echo "=== 6. Testing @klyn/autonomy ==="
pnpm --filter @klyn/autonomy run test

echo "=== 7. Building @klyn/ai-engine ==="
pnpm --filter @klyn/ai-engine run build

echo "=== 8. Testing @klyn/ai-engine ==="
pnpm --filter @klyn/ai-engine run test

echo "=== Sync and build completed successfully! ==="
