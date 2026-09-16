#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[ESM PHASE 7] Removing remaining misplaced imports..."

python3 <<'PY'
from pathlib import Path
import re

files = [
    "kernel/orchestrator.ts",
    "kernel/src/services/arena_gateway.ts",
    "kernel/src/services/realtime_bus.ts",
    "kernel/src/services/state_engine.ts",
]

patterns = [
    r'^\s+import WebSocket from [\'"]ws[\'"];\s*$',
    r'^\s+import fs from [\'"]node:fs[\'"];\s*$',
    r'^\s+import path from [\'"]node:path[\'"];\s*$',
    r'^\s+import \{ execSync \} from [\'"]node:child_process[\'"];\s*$',
    r'^\s+import \{ createClient \} from [\'"]@supabase/supabase-js[\'"];\s*$',
]

for file in files:
    p = Path(file)

    if not p.exists():
        continue

    lines = p.read_text().splitlines()

    new=[]

    for line in lines:
        remove=False

        for pattern in patterns:
            if re.match(pattern,line):
                remove=True
                break

        if not remove:
            new.append(line)

    p.write_text("\n".join(new)+"\n")
    print("Cleaned:",file)

PY

echo "[ESM PHASE 7] Complete"
