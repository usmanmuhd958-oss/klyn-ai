#!/usr/bin/env bash
set -euo pipefail

ROOT="$PWD"
BACKUP="$ROOT/.migration-backup/esm-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP"

echo "[ESM] Creating backup..."

cp -r packages kernel intelligence core agents "$BACKUP/" 2>/dev/null || true


echo "[ESM] Migrating static imports..."

python3 <<'PY'

from pathlib import Path

roots = [
    "packages",
    "kernel",
    "intelligence",
    "core",
    "agents"
]

files=[]

for root in roots:
    for p in Path(root).rglob("*.ts"):
        files.append(p)


replacements = {
    "const fs = require('fs');":
        "import fs from 'node:fs';",

    "const path = require('path');":
        "import path from 'node:path';",

    "const os = require('os');":
        "import os from 'node:os';",

    "const { execSync } = require('child_process');":
        "import { execSync } from 'node:child_process';",
}


for file in files:
    text=file.read_text(errors="ignore")
    original=text

    for old,new in replacements.items():
        text=text.replace(old,new)

    if text != original:
        file.write_text(text)
        print("Updated:", file)

print("ESM static migration finished")

PY


echo "[ESM] Done"
echo "Backup: $BACKUP"
