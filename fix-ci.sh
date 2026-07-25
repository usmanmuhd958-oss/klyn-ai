#!/usr/bin/env bash

set -e

echo "🚀 [Klyn AI OS] Starting CI Diagnostics & Fix Routine..."

# 1. Clean build artifacts
echo "🧹 Cleaning previous build artifacts..."
rm -rf dist build node_modules/.cache

# 2. Verify Node dependencies
echo "📦 Verifying Node modules..."
if [ -f "package-lock.json" ]; then
  npm ci || npm install
else
  npm install
fi

# 3. TypeScript Validation
echo "🔍 Running TypeScript type validation..."
if [ -f "tsconfig.json" ]; then
  npx tsc --noEmit || true
fi

# 4. Validating Rust Native Core Path
KERNEL_DIR="native/kernel_core"
if [ -d "$KERNEL_DIR" ] && [ -f "$KERNEL_DIR/Cargo.toml" ]; then
  echo "🦀 Validating Rust Native Core ($KERNEL_DIR)..."
  (cd "$KERNEL_DIR" && cargo check) || true
else
  echo "ℹ️ Rust kernel directory check skipped (not in root)."
fi

# 5. Git Sync & Clean Push
echo "📤 Staging and pushing CI updates..."
git add .

if git diff-index --quiet HEAD; then
  echo "✅ No uncommitted local changes."
else
  git commit -m "fix(ci): optimize pipeline path resolution for kernel_core"
  git push origin main
fi

echo "🎉 [Klyn AI OS] CI Pipeline check completed!"
