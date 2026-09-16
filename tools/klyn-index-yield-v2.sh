#!/data/data/com.termux/files/usr/bin/bash

echo "=============================="
echo " KLYN INDEX YIELD V2"
echo " SAFE PATCH MODE"
echo "=============================="

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = """setTimeout(() => {
  console.log('[BACKGROUND INDEX] START');

  setImmediate(() => {
    this.indexCodebase();

    console.log('[BACKGROUND INDEX] SAVE');

    this.saveIndexCache();

    console.log('[BACKGROUND INDEX] COMPLETE');
  });

}, 3000);"""

new = """setTimeout(() => {
  console.log('[BACKGROUND INDEX] START');

  if (!this.indexRunning) {
    this.indexRunning = true;

    Promise.resolve()
      .then(() => this.indexCodebase())
      .then(() => {
        console.log('[BACKGROUND INDEX] SAVE');
        this.saveIndexCache();
      })
      .catch(err => {
        console.error('[BACKGROUND INDEX ERROR]', err.message);
      })
      .finally(() => {
        this.indexRunning = false;
        console.log('[BACKGROUND INDEX] COMPLETE');
      });
  }

}, 10000);"""

if old in s:
    s=s.replace(old,new)
    p.write_text(s)
    print("PATCHED")
else:
    print("SKIPPED: pattern not found")
PY

echo "DONE"
