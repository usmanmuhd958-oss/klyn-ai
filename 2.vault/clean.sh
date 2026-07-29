#!/usr/bin/env bash

set -euo pipefail

echo "=== Cleaning KLYN AI OS v3.0 Repo for Pure Kernel Execution ==="

# 1. Remove targeted frontend bloat, modules, and extra icon/motion dependencies
rm -rf apps/web/
rm -rf node_modules/
rm -rf lucide-react/
rm -rf motion-dom/

# 2. Clean up build artifacts and temporary caches if present
rm -rf .next/ .turbo/ dist/ build/ coverage/

# 3. Ensure essential kernel directories exist
mkdir -p 0.kernel 1.brain 2.body 3.memory 4.loops kernel/src

echo "=== Cleanup Complete ==="
echo "Remaining Core Directories:"
ls -d 0.kernel/ 1.brain/ 2.body/ 3.memory/ 4.loops/ kernel/src/ 2>/dev/null
