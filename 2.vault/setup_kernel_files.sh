#!/usr/bin/env bash

set -e

echo "=================================================="
echo "  KLYN AI OS - Enterprise Kernel Setup Script"
echo "=================================================="

# Step 1: Ensure directory structure exists
echo "[1/4] Verifying directory structure..."
mkdir -p native/kernel_core/src
mkdir -p native/kernel_core/include

# Step 2: Create and edit kernel_core.rs
echo "[2/4] Preparing kernel_core.rs..."
TARGET_RUST="native/kernel_core/src/lib.rs"

if [ ! -f "$TARGET_RUST" ]; then
    touch "$TARGET_RUST"
    echo "Created new file at $TARGET_RUST"
else
    echo "File $TARGET_RUST already exists."
fi

echo "Opening nano for $TARGET_RUST..."
echo "Paste your complete Rust enterprise code from Sonnet, save (Ctrl+O, Enter), and exit (Ctrl+X)."
read -p "Press [Enter] to open nano..."
nano "$TARGET_RUST"

# Step 3: Create and edit cognitive_router.c
echo "[3/4] Preparing cognitive_router.c..."
TARGET_C="native/kernel_core/include/cognitive_router.c"

if [ ! -f "$TARGET_C" ]; then
    touch "$TARGET_C"
    echo "Created new file at $TARGET_C"
else
    echo "File $TARGET_C already exists."
fi

echo "Opening nano for $TARGET_C..."
echo "Paste your complete C enterprise code from Sonnet, save (Ctrl+O, Enter), and exit (Ctrl+X)."
read -p "Press [Enter] to open nano..."
nano "$TARGET_C"

# Step 4: Verification
echo "[4/4] Verifying file creation..."
if [ -s "$TARGET_RUST" ] && [ -s "$TARGET_C" ]; then
    echo "--------------------------------------------------"
    echo "SUCCESS: Both enterprise files are successfully saved!"
    echo "Files created:"
    echo "  - $TARGET_RUST"
    echo "  - $TARGET_C"
    echo "--------------------------------------------------"
else
    echo "WARNING: One or both files appear to be empty. Please check contents."
fi
