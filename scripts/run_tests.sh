#!/usr/bin/env bash

# ==============================================================================
# KLYN AI OS - Ultra-Fast Vitest Test Runner
# Zero-Network, Local Memory Isolation Test Engine
# ==============================================================================

set -euo pipefail

VITEST_BIN="./node_modules/.bin/vitest"

if [ ! -f "$VITEST_BIN" ]; then
    echo -e "\033[0;31m[!] Vitest binary not found. Running dev_setup.sh first...\033[0m"
    ./scripts/dev_setup.sh
fi

echo -e "\033[0;36m[KLYN-AI-OS] Running Integration & Kernel Test Matrix...\033[0m"

# Execute Vitest with strict single-run CI flags
$VITEST_BIN run kernel/tests/integration/ --reporter=verbose --run
