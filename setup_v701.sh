#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[GENESIS V701] Initializing at $ROOT"

mkdir -p \
  "$ROOT/0.kernel/src" \
  "$ROOT/1.brain" \
  "$ROOT/2.body"

echo "[GENESIS V701] Ready for module injection"
