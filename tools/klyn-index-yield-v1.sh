#!/data/data/com.termux/files/usr/bin/bash

set -e

cd ~/klyn-ai-os

python3 - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = """setImmediate(() => {
  console.log('[BACKGROUND INDEX] START');

  this.indexCodebase();

  console.log('[BACKGROUND INDEX] SAVE');

  this.saveIndexCache();

  console.log('[BACKGROUND INDEX] COMPLETE');
});"""

new = """setTimeout(() => {
  console.log('[BACKGROUND INDEX] START');

  setImmediate(() => {
    this.indexCodebase();

    console.log('[BACKGROUND INDEX] SAVE');

    this.saveIndexCache();

    console.log('[BACKGROUND INDEX] COMPLETE');
  });

}, 3000);"""

if old in s:
    s=s.replace(old,new)
    p.write_text(s)
    print("PATCHED: delayed background indexing")
else:
    print("SKIPPED: pattern not found")
PY

node --check klyn_server.js

echo "DONE"
