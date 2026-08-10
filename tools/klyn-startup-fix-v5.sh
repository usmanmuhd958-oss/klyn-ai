#!/data/data/com.termux/files/usr/bin/bash

set -e

cp klyn_server.js backups/klyn-runtime-v5/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = """console.log('[TRACE] saveIndexCache START');
this.saveIndexCache();
console.log('[TRACE] saveIndexCache END');"""

new = """setImmediate(() => {
  try {
    console.log('[KLYN CACHE] Background save started');
    this.saveIndexCache();
    console.log('[KLYN CACHE] Background save completed');
  } catch(err) {
    console.error('[KLYN CACHE ERROR]', err);
  }
});"""

if old in s:
    s=s.replace(old,new)
else:
    print("save block not found")

p.write_text(s)
PY

node --check klyn_server.js

echo "KLYN STARTUP FIX V5 READY"
