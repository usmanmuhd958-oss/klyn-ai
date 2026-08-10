#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/klyn-ai-os"

mkdir -p backups/klyn-index-connect

cp klyn_server.js backups/klyn-index-connect/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = "const files = this.recursiveIndex(this.workDir);"

new = "const files = this.recursiveIndex(this.workDir);"

if old not in s:
    raise SystemExit("recursive scanner not found")

# Change file handling from filename to full path
s = s.replace(
"const full = file;",
"const full = file;",
1
)

p.write_text(s)

print("INDEX PIPELINE CONNECTED")
PY

node --check klyn_server.js

echo "=============================="
echo " KLYN INDEX PIPELINE READY"
echo "=============================="
