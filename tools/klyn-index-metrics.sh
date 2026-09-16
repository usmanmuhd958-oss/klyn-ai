#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/klyn-ai-os"

mkdir -p backups/klyn-index-metrics

cp klyn_server.js backups/klyn-index-metrics/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = "this.indexCodebase();"

new = "this.indexCodebase(); console.log('[KLYN] Codebase indexing completed');"

if "[KLYN] Codebase indexing completed" not in s:
    s = s.replace(old, new, 1)

p.write_text(s)

print("METRICS PATCHED")
PY

node --check klyn_server.js

echo "Index metrics ready"
