#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[ESM PHASE 6] Normalizing shebang and imports..."

python3 <<'PY'
from pathlib import Path

files = [
    "kernel/orchestrator.ts",
    "kernel/src/services/arena_gateway.ts",
    "kernel/src/services/realtime_bus.ts",
    "kernel/src/services/state_engine.ts",
]

for f in files:
    p = Path(f)

    if not p.exists():
        continue

    text = p.read_text()

    # Remove all shebang locations
    lines = text.splitlines()

    lines = [
        x for x in lines
        if not x.startswith("#!/usr/bin/env node")
    ]

    # Put shebang only where needed
    if f == "kernel/orchestrator.ts":
        lines.insert(0, "#!/usr/bin/env node")

    p.write_text("\n".join(lines) + "\n")

    print("Fixed:", f)
PY

echo "[ESM PHASE 6] Complete"
