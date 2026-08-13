#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN RUNTIME CONTRACT PATCH V2"
echo " FINAL COMPATIBILITY ALIGNMENT"
echo "======================================"

python3 <<'PY'

from pathlib import Path


# Force add initialize inside BackendKernel class
p=Path("src/backend/core/BackendKernel.ts")

if p.exists():

    data=p.read_text()

    if "initialize()" not in data:

        data=data.replace(
            "{",
            """{

  initialize(){

    return {
      initialized:true,
      status:"READY"
    };

  }

""",
            1
        )

    p.write_text(data)



# Fix IntentRouter return contract

p=Path("src/backend/intelligence/IntentRouter.ts")

if p.exists():

    data=p.read_text()

    data=data.replace(
        'intent:"processed"',
        'type:"processed",\n      intent:"processed"'
    )

    p.write_text(data)


PY


echo
echo "======================================"
echo " PATCH V2 COMPLETE"
echo "======================================"

npm run build

