#!/usr/bin/env bash
set -euo pipefail

python3 <<'PY'

from pathlib import Path


# state_engine dotenv fix

file = Path("kernel/src/services/state_engine.ts")

if file.exists():

    text=file.read_text()
    original=text

    text=text.replace(
        "const dotenv = require('dotenv');",
        "import dotenv from 'dotenv';"
    )

    if text != original:
        file.write_text(text)
        print("Fixed:", file)



# plugin dynamic require -> import

file = Path("kernel/plugin-engine.ts")

if file.exists():

    text=file.read_text()
    original=text

    text=text.replace(
        "const mod = require(indexPath);",
        "const mod = await import(indexPath);"
    )

    if text != original:
        file.write_text(text)
        print("Fixed:", file)



# task queue dynamic require

file = Path("kernel/task-queue.ts")

if file.exists():

    text=file.read_text()
    original=text

    text=text.replace(
        "computeBackoff = require('./backoff').computeBackoff;",
        "const { computeBackoff } = await import('./backoff.js');"
    )

    if text != original:
        file.write_text(text)
        print("Fixed:", file)


print("Phase 4 complete")

PY
