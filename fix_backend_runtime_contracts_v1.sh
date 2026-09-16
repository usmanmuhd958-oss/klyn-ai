#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN RUNTIME CONTRACT PATCH V1"
echo " BACKEND MODULE COMPATIBILITY FIX"
echo "======================================"

python3 <<'PY'

from pathlib import Path

# BackendKernel
p=Path("src/backend/core/BackendKernel.ts")

if p.exists():
    data=p.read_text()

    if "initialize()" not in data:
        data=data.replace(
            "export class BackendKernel {",
            """export class BackendKernel {

  initialize(){

    return {
      initialized:true,
      status:"READY"
    };

  }
"""
        )

    p.write_text(data)


# RuntimeManager
p=Path("src/backend/runtime/RuntimeManager.ts")

if p.exists():
    data=p.read_text()

    if "initialize()" not in data:
        data=data.replace(
            "export class RuntimeManager {",
            """export class RuntimeManager {

  initialize(){

    return {
      initialized:true,
      status:"READY"
    };

  }
"""
        )

    p.write_text(data)


# IntentRouter
p=Path("src/backend/intelligence/IntentRouter.ts")

if p.exists():
    data=p.read_text()

    if "route(" not in data:
        data=data.replace(
            "export class IntentRouter {",
            """export class IntentRouter {

  route(input:any){

    return {
      intent:"processed",
      input
    };

  }
"""
        )

    p.write_text(data)


PY


echo
echo "======================================"
echo " PATCH COMPLETE"
echo "======================================"

npm run build

