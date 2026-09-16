#!/data/data/com.termux/files/usr/bin/bash

echo "=============================="
echo " KLYN DISABLE MAIN INDEX V1"
echo "=============================="

python - <<'PY'
from pathlib import Path

p = Path("klyn_server.js")
s = p.read_text()

start = s.find("setTimeout(() => {")
end = s.find("console.log('[KLYN] Codebase indexing completed');")

if start != -1 and end != -1:
    replacement = """console.log('[KLYN] Background index disabled - worker mode pending');
"""
    s = s[:start] + replacement + s[end + len("console.log('[KLYN] Codebase indexing completed');"):]
    p.write_text(s)
    print("PATCHED: main indexing removed")
else:
    print("SKIPPED: pattern not found")
PY

node --check klyn_server.js

echo "=============================="
echo " READY"
echo "=============================="
