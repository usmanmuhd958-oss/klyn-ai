#!/usr/bin/env bash
set -euo pipefail

pnpm build
pnpm typecheck
pnpm --filter @klyn/execution-runtime test
pnpm --filter @klyn/agent-runtime test
pnpm --filter @klyn/ai-engine test
pnpm --filter @klyn/mission-engine test

echo "[KLYN] kernel execution verification complete"
