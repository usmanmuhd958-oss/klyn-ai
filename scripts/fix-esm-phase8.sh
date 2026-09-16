#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[ESM PHASE 8] Restoring required top-level imports..."

python3 <<'PY'
from pathlib import Path

patches = {
"kernel/src/services/arena_gateway.ts": [
    "import { execSync } from 'node:child_process';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
],
"kernel/src/services/realtime_bus.ts": [
    "import fs from 'node:fs';",
],
"kernel/src/services/state_engine.ts": [
    "import { createClient } from '@supabase/supabase-js';",
],
}

for file, imports in patches.items():
    p = Path(file)

    if not p.exists():
        continue

    text = p.read_text()

    lines = text.splitlines()

    existing = set(lines)

    insert=[]

    for imp in imports:
        if imp not in existing:
            insert.append(imp)

    if insert:
        # keep imports after shebang if present
        index=0
        if lines and lines[0].startswith("#!"):
            index=1

        lines[index:index]=insert

    p.write_text("\n".join(lines)+"\n")

    print("Fixed:", file)

PY

echo "[ESM PHASE 8] Complete"
