#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN INDEX OPTIMIZER V1"
echo " SAFE PATCH MODE"
echo "=============================="

ROOT="$HOME/klyn-ai-os"
BACKUP="$ROOT/backups/klyn-index-optimizer-v1"

mkdir -p "$BACKUP"

cp "$ROOT/klyn_server.js" \
"$BACKUP/klyn_server.js.$(date +%Y%m%d-%H%M%S)"

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")

s = p.read_text()

old = """const files = this.recursiveIndex(this.workDir);"""

new = """const indexStart = Date.now();

    const files = this.recursiveIndex(this.workDir);

    console.log(
      `[KLYN INDEX] Files: ${files.length} Time: ${Date.now() - indexStart}ms`
    );"""

if old in s and "[KLYN INDEX] Files:" not in s:
    s = s.replace(old, new)
    p.write_text(s)
    print("PATCHED: index metrics added")
else:
    print("SKIPPED: patch already applied")

PY

echo "=============================="
echo " READY"
echo " Backup:"
echo "$BACKUP"
echo "=============================="
