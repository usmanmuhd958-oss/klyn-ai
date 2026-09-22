#!/usr/bin/env bash

set -e

echo "=== [1/5] Checking Dependencies ==="
REQUIRED_PKGS=()

command -v node >/dev/null 2>&1 || REQUIRED_PKGS+=("nodejs-lts")
command -v clang >/dev/null 2>&1 || REQUIRED_PKGS+=("clang")
command -v rustc >/dev/null 2>&1 || REQUIRED_PKGS+=("rust")
command -v sqlite3 >/dev/null 2>&1 || REQUIRED_PKGS+=("sqlite")

if [ ${#REQUIRED_PKGS[@]} -gt 0 ]; then
    echo "Installing missing packages: ${REQUIRED_PKGS[*]}"
    pkg install -y "${REQUIRED_PKGS[@]}"
else
    echo "All core dependencies (Node, Clang, Rust, SQLite) are already installed."
fi

echo ""
echo "=== [2/5] Setting Toolchain Variables ==="
export CC="${CC:-clang}"
export CXX="${CXX:-clang++}"
export AR="${AR:-llvm-ar}"

echo "Compiler Environment:"
echo "  CC  = $CC"
echo "  CXX = $CXX"
echo "  AR  = $AR"

echo ""
echo "=== [3/5] Verifying Permissions & Executing Bootstrap Script ==="
if [ -f "./crates/klyn-vaul./bootstrap_klyn_kernel.sh" ]; then
    chmod +x bootstrap_klyn_kernel.sh
    echo "Running ./crates/klyn-vaul./bootstrap_klyn_kernel.sh..."
    ./crates/klyn-vaul./bootstrap_klyn_kernel.sh
else
    echo "Warning: 'bootstrap_klyn_kernel.sh' not found in $(pwd)."
    echo "Ensure you are in the repository root after switching to main."
fi

echo ""
echo "============================================================"
echo "  KLYN AI OS - Termux Setup Completed! 🚀"
echo "============================================================"
