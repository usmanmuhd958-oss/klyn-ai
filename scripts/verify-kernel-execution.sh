#!/usr/bin/env bash
set -euo pipefail

echo "[KLYN] Build"
pnpm build

echo "[KLYN] Typecheck"
pnpm typecheck

echo "[KLYN] Execution runtime tests"
pnpm --filter @klyn/execution-runtime test

echo "[KLYN] Agent runtime tests"
pnpm --filter @klyn/agent-runtime test

echo "[KLYN] AI engine tests"
pnpm --filter @klyn/ai-engine test

echo "[KLYN] Mission engine tests"
pnpm --filter @klyn/mission-engine test

echo "[KLYN] Kernel execution verification complete"
