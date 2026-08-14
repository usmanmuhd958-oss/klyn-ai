#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="$ROOT/apps/studio/src/components/universe/SpatialUniverse.tsx"

echo "=============================================="
echo " KLYN OS SPATIAL HYDRATION FIX"
echo "=============================================="

if [ ! -f "$FILE" ]; then
  echo "ERROR: $FILE not found"
  exit 1
fi

python3 - <<PY
from pathlib import Path

p = Path("$FILE")
s = p.read_text()

s = s.replace(
'''className="
relative
h-screen
w-screen
overflow-hidden
bg-[#0B0C10]
text-[#C5C6C7]
"''',
'''className="relative h-screen w-screen overflow-hidden bg-[#0B0C10] text-[#C5C6C7]"'''
)

s = s.replace(
'''className="
absolute
inset-0
opacity-30
bg-[radial-gradient(#45A29E_1px,transparent_1px)]
[background-size:24px_24px]
"''',
'''className="absolute inset-0 opacity-30 bg-[radial-gradient(#45A29E_1px,transparent_1px)] [background-size:24px_24px]"'''
)

s = s.replace(
'''className="
absolute
inset-0
"''',
'''className="absolute inset-0"'''
)

s = s.replace(
'''className="
absolute
bottom-6
left-1/2
-translate-x-1/2
w-[600px]
rounded-xl
border
border-cyan-400/20
bg-black/40
backdrop-blur-xl
px-6
py-4
"''',
'''className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[600px] rounded-xl border border-cyan-400/20 bg-black/40 backdrop-blur-xl px-6 py-4"'''
)

p.write_text(s)
print("SpatialUniverse fixed")
PY

echo "=============================================="
echo " HYDRATION FIX COMPLETE"
echo "=============================================="
