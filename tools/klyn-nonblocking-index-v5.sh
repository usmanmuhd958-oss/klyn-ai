#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN NONBLOCKING INDEX V5"
echo " SAFE PATCH MODE"
echo "=============================="

cd ~/klyn-ai-os

BACKUP="backups/klyn-nonblocking-index-v5"
mkdir -p "$BACKUP"

cp klyn_server.js "$BACKUP/klyn_server.js.$(date +%Y%m%d-%H%M%S)"

python3 - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = """console.log('[TRACE] indexCodebase START');
this.indexCodebase();
console.log('[TRACE] indexCodebase END');
console.log('[TRACE] saveIndexCache START');
this.saveIndexCache();
console.log('[TRACE] saveIndexCache END');"""

new = """setImmediate(() => {
  console.log('[BACKGROUND INDEX] START');

  this.indexCodebase();

  console.log('[BACKGROUND INDEX] SAVE');

  this.saveIndexCache();

  console.log('[BACKGROUND INDEX] COMPLETE');
});"""

if old in s:
    s = s.replace(old, new)
    p.write_text(s)
    print("PATCHED: background indexing enabled")
else:
    print("SKIPPED: pattern not found (already patched or changed)")
PY

node --check klyn_server.js

echo "=============================="
echo " READY"
echo " Backup:"
echo "$BACKUP"
echo "=============================="
