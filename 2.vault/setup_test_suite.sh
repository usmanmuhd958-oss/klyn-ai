#!/usr/bin/env bash

set -e

echo "=================================================="
echo "  KLYN AI OS - Enterprise Test Suite Setup"
echo "=================================================="

# Ensure directory exists
mkdir -p native/kernel_core/tests

RUST_TEST="native/kernel_core/tests/kernel_core_test.rs"
C_TEST="native/kernel_core/tests/test_cognitive_router.c"

touch "$RUST_TEST"
touch "$C_TEST"

# Step 1: Open Rust Test File
echo ""
echo "[1/2] Preparing Rust Test Suite..."
echo "Target: $RUST_TEST"
echo "Instructions: Paste Rust test code, press Ctrl+O -> Enter -> Ctrl+X"
read -p "Press [Enter] to launch nano..."
nano "$RUST_TEST"

# Step 2: Open C Test File
echo ""
echo "[2/2] Preparing C Test Suite..."
echo "Target: $C_TEST"
echo "Instructions: Paste C test harness code, press Ctrl+O -> Enter -> Ctrl+X"
read -p "Press [Enter] to launch nano..."
nano "$C_TEST"

echo ""
echo "=================================================="
echo "SUCCESS: Both test suites successfully updated!"
echo "Saved files:"
echo "  - $RUST_TEST"
echo "  - $C_TEST"
echo "=================================================="
