#!/usr/bin/env bash
# =============================================================================
# KLYN AI OS — GENESIS v683 — Universal Agent Marketplace Layer
# Bootstrap automation. Compatible with Termux (Android) and Linux.
#
#   Usage:  bash genesis-v683-bootstrap.sh [--typecheck] [--smoke] [--push]
#   - no flags    : materialize the layer (idempotent, safe to re-run)
#   - --typecheck : also typecheck the whole genesis lineage (tsc -p genesis/tsconfig.json)
#   - --smoke     : also run the layer self-test (bun run genesis/v683/smoke.ts)
#   - --push      : also commit + push to GitHub (origin) and GitLab (gitlab)
# =============================================================================
set -euo pipefail

LAYER="v683"
LAYER_NAME="Universal Agent Marketplace Layer"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found. Install it (Termux: pkg install nodejs-lts, Linux: apt install nodejs)."
  exit 1
fi

RUN_TYPECHECK=0
RUN_SMOKE=0
RUN_PUSH=0
for flag in "$@"; do
  case "$flag" in
    --typecheck) RUN_TYPECHECK=1 ;;
    --smoke) RUN_SMOKE=1 ;;
    --push) RUN_PUSH=1 ;;
    *) echo "warning: unknown flag '$flag'" ;;
  esac
done

echo "[GENESIS $LAYER] $LAYER_NAME"
echo "[GENESIS $LAYER] bootstrap start: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1) Materialize the layer via the evolution forge (idempotent)
node genesis/forge.mjs "$LAYER"

# 2) Optional: typecheck the genesis lineage
if [ "$RUN_TYPECHECK" = "1" ]; then
  if [ -x node_modules/.bin/tsc ]; then
    echo "[GENESIS $LAYER] typecheck: genesis lineage"
    node_modules/.bin/tsc --noEmit -p genesis/tsconfig.json
  else
    echo "[GENESIS $LAYER] warning: typescript not installed; skipping typecheck"
  fi
fi

# 3) Optional: smoke test the layer
if [ "$RUN_SMOKE" = "1" ]; then
  if command -v bun >/dev/null 2>&1; then
    echo "[GENESIS $LAYER] smoke test"
    bun run "genesis/$LAYER/smoke.ts"
  else
    echo "[GENESIS $LAYER] warning: bun not found; skipping smoke (Termux: pkg install bun)"
  fi
fi

# 4) Optional: commit + push workflow (GitHub origin + GitLab gitlab)
if [ "$RUN_PUSH" = "1" ]; then
  bash genesis/push-evolution.sh "$LAYER"
fi

MODULE_COUNT="$(ls genesis/$LAYER/*.ts 2>/dev/null | wc -l)"
echo "[GENESIS $LAYER] bootstrap complete: genesis/$LAYER ($MODULE_COUNT TypeScript modules)"
