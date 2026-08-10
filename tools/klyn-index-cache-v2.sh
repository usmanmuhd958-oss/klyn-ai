#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN INDEX CACHE V2"
echo " SAFE PATCH MODE"
echo "=============================="

ROOT="$HOME/klyn-ai-os"
BACKUP="$ROOT/backups/klyn-index-cache-v2"

mkdir -p "$BACKUP"

cp klyn_server.js \
"$BACKUP/klyn_server.js.$(date +%Y%m%d-%H%M%S)"

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

marker = "this.indexCodebase(); console.log('[KLYN] Codebase indexing completed');"

replacement = """
this.loadIndexCache();
this.indexCodebase();
this.saveIndexCache();
console.log('[KLYN] Codebase indexing completed');
"""

if marker in s and "loadIndexCache()" not in s:
    s = s.replace(marker, replacement.strip())
    p.write_text(s)
    print("PATCHED: index cache hooks added")
else:
    print("SKIPPED: cache hooks already exist")

PY

echo "=============================="
echo " INDEX CACHE V2 READY"
echo " Backup:"
echo "$BACKUP"
echo "=============================="
