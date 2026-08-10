#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="$HOME/klyn-ai-os"
BACKUP="$ROOT/backups/klyn-recursive-index"

cd "$ROOT"

mkdir -p "$BACKUP"

cp klyn_server.js "$BACKUP/klyn_server.js.$(date +%Y%m%d-%H%M%S)"

echo "=============================="
echo " KLYN RECURSIVE INDEX PATCH"
echo " SAFE MODE"
echo "=============================="

if grep -q "recursiveIndex" klyn_server.js; then
    echo "[SKIP] Patch already exists"
    exit 0
fi

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

marker = "  indexCodebase() {"

inject = r'''
  recursiveIndex(dir, results = []) {
    const ignore = [
      "node_modules",
      ".git",
      "target",
      "vault_data"
    ];

    for (const item of fs.readdirSync(dir)) {
      if (ignore.includes(item)) continue;

      const full = path.join(dir, item);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        this.recursiveIndex(full, results);
      } else if (
        item.endsWith(".js") ||
        item.endsWith(".ts")
      ) {
        results.push(full);
      }
    }

    return results;
  }

'''

if marker not in s:
    raise SystemExit("marker not found")

s = s.replace(marker, inject + marker)

p.write_text(s)

print("PATCHED")
PY

echo "[DONE] Recursive index helper added"
echo "Backup:"
echo "$BACKUP"
