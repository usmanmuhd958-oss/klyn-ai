#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/klyn-ai-os"

mkdir -p backups/klyn-memory-debug

cp klyn_server.js backups/klyn-memory-debug/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

marker = "const engine = new KlynServerEngine(__dirname);"

insert = """
const memoryDebug = () => ({
  status: "ok",
  message: "KLYN memory debug active"
});

"""

if "memoryDebug" not in s:
    s = s.replace(marker, insert + marker)

p.write_text(s)

print("DEBUG PATCH ADDED")
PY

node --check klyn_server.js

echo "Memory debug patch ready"
