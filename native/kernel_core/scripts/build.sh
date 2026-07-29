#!/usr/bin/env bash
set -euo pipefail

echo "[+] Building KLYN AI OS Rust Core Native Binary..."
cargo build --manifest-path native/kernel_core/Cargo.toml --release

echo "[✓] Rust Native Kernel Core Compiled Successfully! 🚀"
