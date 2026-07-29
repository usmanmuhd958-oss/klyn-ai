#!/usr/bin/env bash

# Klyn AI OS - Ultra Interactive Setup Script
set -e

PROJECT_DIR="$HOME/klyn-ai-os"

if [ -d "$PROJECT_DIR" ]; then
  cd "$PROJECT_DIR"
else
  mkdir -p "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

FILES=(
  "src/types/core.ts"
  "src/core/hash.ts"
  "src/core/merkle_dag.ts"
  "src/parser/language_detector.ts"
  "src/parser/ast_parser.ts"
  "src/graph/dependency_graph.ts"
  "src/indexer/file_scanner.ts"
  "src/indexer/repository_indexer.ts"
  "src/engine/klyn_engine.ts"
  "src/cli/commands.ts"
  "src/main.ts"
  "package.json"
  "tsconfig.json"
  "benchmark/perf_test.ts"
  "kernel/src/pipeline/repo_ingest.ts"
  "kernel/src/dag/merkle_engine.ts"
  "kernel/src/pipeline/integration_test.ts"
  "kernel/src/types/pipeline.ts"
  "kernel/src/ast/dependency_graph.ts"
  "kernel/src/ast/symbol_index.ts"
  "kernel/src/ast/impact_analyzer.ts"
  "kernel/src/ast/test_dependency_graph.ts"
  "1.brain/cognitive_router.ts"
  "1.brain/patch_generator.ts"
  "1.brain/patch_validator.ts"
  "1.brain/agent_engine.ts"
  "1.brain/test_agent_engine.ts"
  "1.brain/examples/example_usage.ts"
)

TOTAL=${#FILES[@]}
CURRENT=1

echo "=========================================================="
echo "    KLYN AI OS — ARCHITECT INTERACTIVE NANO SEQUENCE     "
echo "=========================================================="
echo " Total Architecture Files: $TOTAL"
echo ""

for FILE in "${FILES[@]}"; do
  DIR=$(dirname "$FILE")
  mkdir -p "$DIR"
  touch "$FILE"

  echo "----------------------------------------------------------"
  echo " File [$CURRENT/$TOTAL]: $FILE"
  echo "----------------------------------------------------------"
  read -p "Press [ENTER] to open in nano (or Ctrl+C to stop)... " dummy

  nano "$FILE"

  echo "[DONE] Saved: $FILE"
  echo ""
  CURRENT=$((CURRENT + 1))
done

echo "=========================================================="
echo "   🚀 KLYN AI OS ARCHITECTURE FULLY BUILT & UPDATED! 🚀    "
echo "=========================================================="
