#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/klyn-ai-os"

mkdir -p backups/klyn-scanner-ignore

cp klyn_server.js backups/klyn-scanner-ignore/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = '''"node_modules",
      ".git",
      "target",
      "vault_data"'''

new = '''"node_modules",
      ".git",
      "target",
      "vault_data",
      ".migration-backup",
      "backups",
      "dist"'''

if old not in s:
    raise SystemExit("ignore block not found")

p.write_text(s.replace(old,new))
print("IGNORE PATCHED")
PY

node --check klyn_server.js

echo "Scanner ignore rules updated"
