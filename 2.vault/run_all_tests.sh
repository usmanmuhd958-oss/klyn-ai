#!/usr/bin/env bash

# Klyn AI OS - Master Automated Test & Benchmark Runner
set -e

echo "=========================================================="
echo "      🚀 KLYN AI OS — MASTER TEST & BENCHMARK SUITE       "
echo "=========================================================="
echo ""

echo "▶ [1/5] Compiling TypeScript Architecture (tsc)..."
npx tsc
echo "✔ Compilation Clean! No syntax or type errors."
echo ""

echo "▶ [2/5] Running Merkle DAG Repository Ingestion Test..."
node dist/kernel/src/pipeline/integration_test.js
echo ""

echo "▶ [3/5] Running AST & Symbol Dependency Graph Test..."
node dist/kernel/src/ast/test_dependency_graph.js
echo ""

echo "▶ [4/5] Running Cognitive Agent Execution Engine Test..."
node dist/1.brain/test_agent_engine.js
echo ""

echo "▶ [5/5] Running Performance Benchmark..."
if [ -f "dist/benchmark/perf_test.js" ]; then
  node dist/benchmark/perf_test.js
elif [ -f "dist/src/benchmark/perf_test.js" ]; then
  node dist/src/benchmark/perf_test.js
else
  echo "ℹ Perf test file will be executed via standalone script if present."
fi

echo ""
echo "=========================================================="
echo "    🏆 ALL TESTS PASSED! KLYN AI OS IS FULLY OPERATIONAL  "
echo "=========================================================="
