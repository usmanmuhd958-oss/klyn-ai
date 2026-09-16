#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN INDEX CACHE FUNCTIONS V2"
echo " SAFE PATCH"
echo "=============================="

mkdir -p backups/klyn-index-cache-functions-v2

cp klyn_server.js \
backups/klyn-index-cache-functions-v2/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

marker = "  indexCodebase() {"

insert = r'''
  loadIndexCache() {
    try {
      const cache = path.join(this.workDir, ".klyn-index-cache.json");

      if (fs.existsSync(cache)) {
        this.indexCache = JSON.parse(
          fs.readFileSync(cache, "utf8")
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
      const cache = path.join(this.workDir, ".klyn-index-cache.json");

      fs.writeFileSync(
        cache,
        JSON.stringify(this.indexCache || {}, null, 2)
      );
    } catch {}
  }

'''

if "loadIndexCache()" not in s:
    s = s.replace(marker, insert + marker)
    p.write_text(s)
    print("PATCHED")
else:
    print("SKIPPED")

PY

echo "=============================="
echo " CACHE FUNCTIONS READY"
echo "=============================="
