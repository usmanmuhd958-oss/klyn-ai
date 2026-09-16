#!/usr/bin/env bash
set -euo pipefail

# Vercel Ignore Build Step: exit 0 to skip, exit 1 to build.
BASE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
HEAD_SHA="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

if ! git rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null 2>&1; then
  exit 1
fi

if git diff --quiet "$BASE_SHA" "$HEAD_SHA" -- apps/backend; then
  echo "Vercel build ignored: no apps/backend changes."
  exit 0
fi

echo "Vercel build required: apps/backend changed."
exit 1
