#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN BACKEND KERNEL PATCH V3"
echo " ADD INITIALIZE CONTRACT"
echo "======================================"

python3 <<'PY'
from pathlib import Path
import re

path = Path("src/backend/core/BackendKernel.ts")

if not path.exists():
    raise SystemExit("BackendKernel.ts not found")

data = path.read_text()

if "initialize()" not in data:

    match = re.search(
        r"(export\s+class\s+BackendKernel\s*\{)",
        data
    )

    if not match:
        raise SystemExit("BackendKernel class declaration not found")

    insert = r'''

  initialize(){

    return {
      initialized: true,
      status: "READY"
    };

  }

'''

    data = (
        data[:match.end()]
        + insert
        + data[match.end():]
    )

    path.write_text(data)

else:
    print("initialize() already exists")

PY


echo
echo "======================================"
echo " PATCH COMPLETE"
echo "======================================"

npm run build

