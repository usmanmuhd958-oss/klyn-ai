#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/klyn-ai-os"

python - <<'PY'
from pathlib import Path

p = Path("index.js")
s = p.read_text()

old = '''      if (text.includes("klyn")) boost += 0.15;
      if (text.includes("server")) boost += 0.15;
      if (tags.includes("ast")) boost += 0.05;'''

new = '''      if (text.includes("klyn")) boost += 0.15;
      if (text.includes("server")) boost += 0.20;
      if (text.includes("gateway")) boost += 0.20;

      const pathText = text + tags;

      if (pathText.includes("klyn_server")) boost += 0.50;
      if (pathText.includes("api/server")) boost += 0.30;
      if (pathText.includes("gateway")) boost += 0.25;

      if (tags.includes("ast")) boost += 0.05;'''

if old not in s:
    raise SystemExit("block not found")

p.write_text(s.replace(old,new))

print("RETRIEVAL V3 PATCHED")
PY

node --check index.js
