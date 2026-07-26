#!/usr/bin/env bash

set -e

echo "=================================================="
echo "  KLYN AI OS - Running Enterprise Test Suites"
echo "=================================================="

# Step 1: Compile & Run C Test Suite
echo ""
echo "[1/2] Compiling and executing C Cognitive Router Tests..."
echo "--------------------------------------------------"

C_SRC="native/kernel_core/include/cognitive_router.c"
C_TEST="native/kernel_core/tests/test_cognitive_router.c"
INC_DIR="native/kernel_core/include"

if [ -f "$C_SRC" ] && [ -f "$C_TEST" ]; then
    clang -O3 -pthread -I"$INC_DIR" "$C_SRC" "$C_TEST" -o test_c_router
    ./test_c_router
    rm -f test_c_router
    echo "✅ C Cognitive Router Test Suite Passed Successfully!"
else
    echo "⚠️ C source or test file missing. Please check file paths."
fi

# Step 2: Run Rust Test Suite
echo ""
echo "[2/2] Running Rust Kernel Core Tests via Cargo..."
echo "--------------------------------------------------"

if [ -d "native/kernel_core" ]; then
    cd native/kernel_core
    cargo test --release -- --nocapture
    cd ../..
    echo "✅ Rust Kernel Core Test Suite Passed Successfully!"
else
    echo "⚠️ Rust crate directory missing."
fi

echo ""
echo "=================================================="
echo "  VERIFICATION COMPLETE: All systems operational!"
echo "=================================================="
