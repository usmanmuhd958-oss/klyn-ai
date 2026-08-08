#!/data/data/com.termux/files/usr/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

mkdir -p architecture/graph

OUTPUT="architecture/graph/live-dependency-graph.json"

echo "[DEPENDENCY INTELLIGENCE] Generating graph"

python - <<'PY'
import json
import subprocess
from pathlib import Path

root = Path(".")

targets = [
    "packages",
    "kernel",
    "intelligence",
    "core",
    "agents"
]

results = []

for target in targets:
    path = root / target

    if not path.exists():
        continue

    try:
        output = subprocess.check_output(
            [
                "grep",
                "-R",
                "import ",
                "--include=*.ts",
                str(path)
            ],
            text=True,
            stderr=subprocess.DEVNULL
        )

        for line in output.splitlines():
            results.append(line)

    except subprocess.CalledProcessError:
        pass


graph = {
    "generated": True,
    "modules": results
}

with open(
    "architecture/graph/live-dependency-graph.json",
    "w"
) as f:
    json.dump(
        graph,
        f,
        indent=2
    )

print("architecture/graph/live-dependency-graph.json")
PY

echo "[DEPENDENCY INTELLIGENCE] Graph generated"
