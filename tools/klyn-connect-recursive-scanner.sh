#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="$HOME/klyn-ai-os"
BACKUP="$ROOT/backups/klyn-connect-recursive"

cd "$ROOT"

mkdir -p "$BACKUP"

cp klyn_server.js "$BACKUP/klyn_server.js.$(date +%Y%m%d-%H%M%S)"

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = "const files = fs.readdirSync(this.workDir);"

new = "const files = this.recursiveIndex(this.workDir);"

if old not in s:
    raise SystemExit("Scanner pattern not found")

s = s.replace(old, new, 1)

s = s.replace(
"const full = path.join(this.workDir, file);",
"const full = file;",
1
)

p.write_text(s)

print("PATCHED")
PY

node --check klyn_server.js

echo "=============================="
echo " RECURSIVE SCANNER CONNECTED"
echo " Backup:"
echo "$BACKUP"
echo "=============================="
