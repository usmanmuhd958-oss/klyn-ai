#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN LISTEN TRACE"
echo "=============================="

cp klyn_server.js backups/klyn-runtime-trace-v2/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python - <<'PY'
from pathlib import Path

p=Path("klyn_server.js")
s=p.read_text()

s=s.replace(
"this.loadIndexCache();",
"console.log('[TRACE] loadIndexCache START');\nthis.loadIndexCache();\nconsole.log('[TRACE] loadIndexCache END');"
)

s=s.replace(
"this.indexCodebase();",
"console.log('[TRACE] indexCodebase START');\nthis.indexCodebase();\nconsole.log('[TRACE] indexCodebase END');",
1
)

s=s.replace(
"this.saveIndexCache();",
"console.log('[TRACE] saveIndexCache START');\nthis.saveIndexCache();\nconsole.log('[TRACE] saveIndexCache END');"
)

s=s.replace(
"server.listen(port, '0.0.0.0', () => {",
"console.log('[TRACE] BEFORE LISTEN');\nserver.listen(port, '0.0.0.0', () => {"
)

p.write_text(s)
PY

node --check klyn_server.js

echo "TRACE PATCH READY"
