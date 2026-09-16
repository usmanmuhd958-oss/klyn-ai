#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN TYPESCRIPT ESM IMPORT FIX"
echo " NODE16/NODENEXT COMPATIBILITY PATCH"
echo "======================================"

find src/backend -type f -name "*.ts" | while read file
do

python3 - "$file" <<'PY'
import sys,re

path=sys.argv[1]

with open(path,"r") as f:
    data=f.read()

# Fix relative imports without extension
data=re.sub(
    r'(from\s+["\'])(\./|\.\./)([^"\']+?)(["\'])',
    lambda m:
        m.group(1)
        + m.group(2)
        + m.group(3)
        + ("" if m.group(3).endswith(".js") else ".js")
        + m.group(4),
    data
)

with open(path,"w") as f:
    f.write(data)

PY

done


echo
echo "======================================"
echo " IMPORT PATCH COMPLETE"
echo "======================================"

echo "Running typecheck..."

npm run typecheck

