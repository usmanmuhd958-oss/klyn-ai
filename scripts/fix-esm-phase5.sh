#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[ESM PHASE 5] Repairing misplaced imports..."

repair_file() {
    file="$1"

    [ -f "$file" ] || return

    cp "$file" ".migration-backup/phase5-$(basename "$file")"

    python3 - "$file" <<'PY'
import sys,re

path=sys.argv[1]

with open(path) as f:
    lines=f.readlines()

imports=[]
body=[]

inside=False

for line in lines:
    if re.match(r'^\s*import\s+', line):
        imports.append(line)
    else:
        body.append(line)

# Remove duplicate imports
seen=set()
clean=[]
for i in imports:
    key=i.strip()
    if key not in seen:
        seen.add(key)
        clean.append(i)

# Remove imports accidentally left inside functions
text="".join(body)

# Remove common broken injected imports
patterns=[
    r'\s+import WebSocket from [\'"]ws[\'"];',
    r'\s+import fs from [\'"]node:fs[\'"];',
    r'\s+import path from [\'"]node:path[\'"];',
    r'\s+import dotenv from [\'"]dotenv[\'"];',
    r'\s+import \{ createClient \} from [\'"]@supabase/supabase-js[\'"];',
    r'\s+import \{ execSync \} from [\'"]node:child_process[\'"];'
]

for p in patterns:
    text=re.sub(p,'\n',text)

output="".join(clean)+"\n"+text

with open(path,"w") as f:
    f.write(output)

print("Fixed:",path)
PY
}


mkdir -p .migration-backup

repair_file kernel/orchestrator.ts
repair_file kernel/src/services/arena_gateway.ts
repair_file kernel/src/services/realtime_bus.ts
repair_file kernel/src/services/state_engine.ts

echo "[ESM PHASE 5] Complete"
