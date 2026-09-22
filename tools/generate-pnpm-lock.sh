#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm --version
pnpm install --lockfile-only

echo "Generated pnpm-lock.yaml. Next run:"
echo "  pnpm install --frozen-lockfile"
echo "  pnpm typecheck"
echo "  pnpm build"
echo "  pnpm test"
echo "  git diff --check"
