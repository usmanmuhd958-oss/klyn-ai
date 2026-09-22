#!/usr/bin/env bash
set -euo pipefail

echo "[CLEAN] Removing generated files"

rm -rf \
node_modules \
target \
dist \
.cache \
.tmp


find . \
-path "./.git" -prune -o \
-path "./archive-history" -prune -o \
-name "*.log" \
-delete


echo "[CLEAN] Done"
