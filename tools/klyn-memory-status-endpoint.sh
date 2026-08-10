#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/klyn-ai-os"

mkdir -p backups/klyn-memory-status

cp index.js backups/klyn-memory-status/index.js.$(date +%Y%m%d-%H%M%S)
cp klyn_server.js backups/klyn-memory-status/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("index.js")
s = p.read_text()

if "export function memoryStats" not in s:
    s += """

export function memoryStats() {
  return {
    size: memoryMap.size,
    namespaces: [...new Set(
      Array.from(memoryMap.values()).map(m => m.namespace)
    )]
  };
}
"""

p.write_text(s)

p = Path("klyn_server.js")
s = p.read_text()

s = s.replace(
"import { initializeVault, storeMemory, recall } from './index.js';",
"import { initializeVault, storeMemory, recall, memoryStats } from './index.js';"
)

if "/v1/memory-status" not in s:
    s = s.replace(
"if (req.method === 'POST' && req.url === '/v1/context') {",
"""if (req.method === 'GET' && req.url === '/v1/memory-status') {
          res.end(JSON.stringify(memoryStats()));
        } else if (req.method === 'POST' && req.url === '/v1/context') {"""
)

p.write_text(s)

print("MEMORY STATUS PATCHED")
PY

node --check index.js
node --check klyn_server.js

echo "READY"
