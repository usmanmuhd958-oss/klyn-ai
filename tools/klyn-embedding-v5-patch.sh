#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/klyn-ai-os"

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

old = '''storeMemory(`srv_${file}_${blockIdx++}`, "law_core_v1", this.generateEmbedding(code), Buffer.from(JSON.stringify({ file, blockName, code })), [file, "ast"]);'''

new = '''storeMemory(
  `srv_${file}_${blockIdx++}`,
  "law_core_v1",
  this.generateEmbedding(`${file} ${blockName} ${code}`),
  Buffer.from(JSON.stringify({ file, blockName, code })),
  [file, "ast"]
);'''

if old not in s:
    raise SystemExit("embedding target not found")

s = s.replace(old,new)

p.write_text(s)

print("EMBEDDING V5 PATCHED")
PY

node --check klyn_server.js
echo "READY"
