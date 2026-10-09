#!/usr/bin/env bash
set -euo pipefail

# Skip only changes that cannot affect the backend deployment.
BASE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
HEAD_SHA="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

if ! git rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null 2>&1; then
  exit 1
fi

if git diff --quiet "$BASE_SHA" "$HEAD_SHA" -- apps/backend vercel.json package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json; then
  echo "Vercel build ignored: no backend source or build configuration changes."
  exit 0
fi

echo "Vercel build required: backend source or build configuration changed."
exit 1
