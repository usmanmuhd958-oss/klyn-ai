#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN NON BLOCKING INDEX V4"
echo "=============================="

cp klyn_server.js backups/klyn-runtime-v4/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = """this.loadIndexCache();
this.indexCodebase();
this.saveIndexCache();"""

new = """this.loadIndexCache();

setImmediate(() => {
  try {
    console.log('[KLYN BACKGROUND] Index rebuild started');
    this.indexCodebase();
    this.saveIndexCache();
    console.log('[KLYN BACKGROUND] Index rebuild completed');
  } catch (err) {
    console.error('[KLYN BACKGROUND] Index error', err);
  }
});"""

if old in s:
    s=s.replace(old,new)
else:
    print("Pattern not found - manual check required")

p.write_text(s)
PY

node --check klyn_server.js

echo "PATCH READY"
