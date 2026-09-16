#!/data/data/com.termux/files/usr/bin/bash

set -e

cd ~/klyn-ai-os

echo "=============================="
echo " KLYN NONBLOCKING INDEX V6"
echo " SAFE PATCH MODE"
echo "=============================="

mkdir -p backups/klyn-nonblocking-index-v6

cp klyn_server.js backups/klyn-nonblocking-index-v6/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python3 - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

start = s.find("console.log('[TRACE] indexCodebase START');")
end = s.find("console.log('[KLYN] Codebase indexing completed');")

if start != -1 and end != -1:

    block = s[start:end]

    new = """setImmediate(() => {
  console.log('[BACKGROUND INDEX] START');

  this.indexCodebase();

  console.log('[BACKGROUND INDEX] SAVE');

  this.saveIndexCache();

  console.log('[BACKGROUND INDEX] COMPLETE');
});
"""

    s = s[:start] + new + s[end:]

    p.write_text(s)
    print("PATCHED: constructor indexing moved to background")
else:
    print("SKIPPED: block not found")
PY

node --check klyn_server.js

echo "=============================="
echo " COMPLETE"
echo " Backup: backups/klyn-nonblocking-index-v6"
echo "=============================="
