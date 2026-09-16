#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/klyn-ai-os"

python - <<'PY'
from pathlib import Path

p = Path("index.js")
s = p.read_text()

old = '''      const text = JSON.stringify(m.payload).toLowerCase();
      const tags = (m.tags || []).join(" ").toLowerCase();'''

new = '''      let text = "";
      try {
        if (Buffer.isBuffer(m.payload)) {
          text = m.payload.toString("utf8").toLowerCase();
        } else {
          text = JSON.stringify(m.payload).toLowerCase();
        }
      } catch {
        text = "";
      }

      const tags = (m.tags || []).join(" ").toLowerCase();'''

if old not in s:
    raise SystemExit("payload block not found")

p.write_text(s.replace(old,new))

print("RETRIEVAL V4 PATCHED")
PY

node --check index.js

echo "READY"
