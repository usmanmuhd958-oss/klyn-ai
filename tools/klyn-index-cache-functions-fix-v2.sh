#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN CACHE FUNCTION FIX V2"
echo " SAFE MODE"
echo "=============================="

mkdir -p backups/klyn-cache-function-fix-v2

cp klyn_server.js \
backups/klyn-cache-function-fix-v2/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

if "loadIndexCache() {" not in s:

    marker = "  indexCodebase() {"

    block = r'''
  loadIndexCache() {
    try {
      const cacheFile = path.join(
        this.workDir,
        ".klyn-index-cache.json"
      );

      if (fs.existsSync(cacheFile)) {
        this.indexCache = JSON.parse(
          fs.readFileSync(cacheFile, "utf8")
        );
      } else {
        this.indexCache = {};
      }
    } catch {
      this.indexCache = {};
    }
  }

  saveIndexCache() {
    try {
      const cacheFile = path.join(
        this.workDir,
        ".klyn-index-cache.json"
      );

      fs.writeFileSync(
        cacheFile,
        JSON.stringify(this.indexCache || {}, null, 2)
      );
    } catch {}
  }

'''

    s = s.replace(marker, block + marker)
    p.write_text(s)

    print("PATCHED: cache functions added")
else:
    print("ALREADY EXISTS")

PY

echo "=============================="
echo " DONE"
echo "=============================="
