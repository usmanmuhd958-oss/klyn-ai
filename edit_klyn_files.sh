#!/usr/bin/env bash

# Klyn AI OS - Automated Interactive Nano Editor Script
set -e

PROJECT_DIR="$HOME/klyn-ai-os"

if [ -d "$PROJECT_DIR" ]; then
  cd "$PROJECT_DIR"
else
  mkdir -p "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

FILES=(
  "core/errors.ts"
  "kernel/src/dag/merkle_engine.ts"
  "kernel/src/pipeline/repo_ingest.ts"
  "kernel/src/ast/dependency_graph.ts"
  "kernel/src/pipeline/context_pruner.ts"
  "1.brain/cognitive_router.ts"
  "1.brain/agent_engine.ts"
  "4.mouth/cli.ts"
)

echo "=================================================="
echo "   KLYN AI OS - Interactive Nano Setup Sequence   "
echo "=================================================="
echo ""

TOTAL=${#FILES[@]}
CURRENT=1

for FILE in "${FILES[@]}"; do
  DIR=$(dirname "$FILE")
  mkdir -p "$DIR"
  touch "$FILE"

  echo "--------------------------------------------------"
  echo " File [$CURRENT/$TOTAL]: $FILE"
  echo "--------------------------------------------------"
  read -p "Press [ENTER] to open in nano (or Ctrl+C to abort)... " dummy

  nano "$FILE"

  echo "[DONE] Processed: $FILE"
  echo ""
  CURRENT=$((CURRENT + 1))
done

echo "=================================================="
echo "   All Klyn AI OS source files updated cleanly!   "
echo "=================================================="
