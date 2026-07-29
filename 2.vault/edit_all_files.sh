#!/usr/bin/env bash

# Make directories
mkdir -p native/kernel_core/src

echo "[1/3] Opening native/kernel_core/Cargo.toml in nano..."
sleep 1
nano native/kernel_core/Cargo.toml

echo "[2/3] Opening native/kernel_core/src/lib.rs in nano..."
sleep 1
nano native/kernel_core/src/lib.rs

echo "[3/3] Opening native/kernel_core/index.d.ts in nano..."
sleep 1
nano native/kernel_core/index.d.ts

echo "ALL FILES EDITED AND SAVED SUCCESSFULLY! 🚀"
