#!/usr/bin/env bash
set -euo pipefail

# Vercel Ignore Build Step: skip only when backend source and build config are unchanged.
BASE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
HEAD_SHA="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

if ! git rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null 2>&1; then
  exit 1
fi

WATCHED_PATHS=(
  apps/backend
  packages
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  turbo.json
  vercel.json
  vercel-ignore-build.sh
)

if git diff --quiet "$BASE_SHA" "$HEAD_SHA" -- "${WATCHED_PATHS[@]}"; then
  echo "Vercel build ignored: no backend source or build configuration changes."
  exit 0
fi

echo "Vercel build required: backend source or build configuration changed."
exit 1
