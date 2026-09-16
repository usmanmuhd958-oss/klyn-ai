#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN MEMORY V3 PATCH"
echo " SAFE PERSISTENT MODE"
echo "=============================="

mkdir -p backups/klyn-memory-v3-live

cp index.js backups/klyn-memory-v3-live/index.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p = Path("index.js")
s = p.read_text()

s = s.replace(
"const memoryMap = new Map();",
"""const memoryMap = new Map();
let vaultFile = null;

function saveVault() {
  if (!vaultFile) return;

  const data = [];

  for (const item of memoryMap.values()) {
    data.push({
      ...item,
      payload: Buffer.isBuffer(item.payload)
        ? item.payload.toString("base64")
        : item.payload
    });
  }

  fs.writeFileSync(
    vaultFile,
    JSON.stringify(data)
  );
}

function loadVault() {
  if (!vaultFile || !fs.existsSync(vaultFile)) return;

  try {
    const data = JSON.parse(
      fs.readFileSync(vaultFile, "utf8")
    );

    for (const item of data) {
      item.payload = Buffer.from(
        item.payload,
        "base64"
      );

      memoryMap.set(item.id, item);
    }

  } catch {}
}"""
)

s = s.replace(
"""export function initializeVault(vaultPath) {
  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }
}""",
"""export function initializeVault(vaultPath) {
  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }

  vaultFile = path.join(
    vaultPath,
    "memory-store.json"
  );

  loadVault();
}"""
)

s = s.replace(
"""memoryMap.set(id, { id, namespace, embedding, payload, tags });""",
"""memoryMap.set(id, { id, namespace, embedding, payload, tags });
  saveVault();"""
)

p.write_text(s)
PY

echo "PATCHED"
