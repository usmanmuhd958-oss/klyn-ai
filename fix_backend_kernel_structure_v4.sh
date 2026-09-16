#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN BACKEND KERNEL STRUCTURE FIX V4"
echo " MOVE INITIALIZE INTO CLASS"
echo "======================================"

python3 <<'PY'
from pathlib import Path
import re

path = Path("src/backend/core/BackendKernel.ts")

data = path.read_text()

print("Checking BackendKernel.ts structure...")

# remove standalone initialize block if exists
standalone = re.search(
    r'\n\s*initialize\s*\(\)\s*\{.*?\n\s*\}\s*',
    data,
    re.S
)

method = """
  initialize(){

    return {
      initialized:true,
      status:"READY"
    };

  }
"""

if standalone:
    print("Found initialize block")

# find class
cls = re.search(
    r'(export\s+class\s+BackendKernel\s*\{)',
    data
)

if not cls:
    raise SystemExit("BackendKernel class not found")

# remove all initialize occurrences first
data = re.sub(
    r'\n\s*initialize\s*\(\)\s*\{.*?\n\s*\}\s*',
    '\n',
    data,
    flags=re.S
)

# insert inside class
data = data[:cls.end()] + "\n" + method + "\n" + data[cls.end():]

path.write_text(data)

print("BackendKernel repaired")

PY


echo
echo "======================================"
echo " STRUCTURE PATCH COMPLETE"
echo "======================================"

npm run build

