#!/data/data/com.termux/files/usr/bin/bash

echo "=============================="
echo " KLYN EVENT LOOP FIX V1"
echo " SAFE PATCH MODE"
echo "=============================="

FILE="klyn_server.js"

mkdir -p backups/klyn-eventloop-fix-v1
cp "$FILE" backups/klyn-eventloop-fix-v1/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = """this.indexCodebase();
console.log('[BACKGROUND INDEX] SAVE');
this.saveIndexCache();
console.log('[BACKGROUND INDEX] COMPLETE');"""

new = """setTimeout(() => {
  console.log('[BACKGROUND INDEX] START');

  try {
    this.indexCodebase();

    console.log('[BACKGROUND INDEX] SAVE');
    this.saveIndexCache();

    console.log('[BACKGROUND INDEX] COMPLETE');
  } catch (err) {
    console.error('[BACKGROUND INDEX ERROR]', err.message);
  }

}, 5000);"""

if old in s:
    s=s.replace(old,new)
    p.write_text(s)
    print("PATCHED")
else:
    print("SKIPPED: pattern not found")
PY

echo "=============================="
echo " READY"
echo "=============================="
