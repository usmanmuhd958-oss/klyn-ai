#!/usr/bin/env bash

set -e

echo "=================================================="
echo "  KLYN AI OS - Kernel Files Setup"
echo "=================================================="

# Create target directories
mkdir -p native/kernel_core/src
mkdir -p native/kernel_core/include

RUST_FILE="native/kernel_core/src/kernel_core.rs"
C_FILE="native/kernel_core/include/cognitive_router.c"

# Touch files to create them if they don't exist
touch "$RUST_FILE"
touch "$C_FILE"

# Step 1: Open kernel_core.rs
echo ""
echo "[1/2] Opening $RUST_FILE in nano..."
echo "Instructions: Paste your Rust code, then press Ctrl+O -> Enter -> Ctrl+X"
read -p "Press [Enter] to launch nano for kernel_core.rs..."
nano "$RUST_FILE"

# Step 2: Open cognitive_router.c
echo ""
echo "[2/2] Opening $C_FILE in nano..."
echo "Instructions: Paste your C code, then press Ctrl+O -> Enter -> Ctrl+X"
read -p "Press [Enter] to launch nano for cognitive_router.c..."
nano "$C_FILE"

echo ""
echo "=================================================="
echo "SUCCESS: Both files created and updated!"
echo "  - $RUST_FILE"
echo "  - $C_FILE"
echo "=================================================="
