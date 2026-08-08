#!/usr/bin/env bash
set -euo pipefail

python3 <<'PY'

from pathlib import Path


files = [
    Path("kernel/kernel-entry.ts"),
    Path("kernel/orchestrator.ts"),
    Path("kernel/src/services/state_engine.ts"),
]


for file in files:

    if not file.exists():
        continue

    text=file.read_text()
    original=text


    # dotenv
    if "require('dotenv')" in text:
        text=text.replace(
            "require('dotenv').config(",
            "dotenv.config("
        )

        if "import dotenv from 'dotenv';" not in text:
            text="import dotenv from 'dotenv';\n"+text


    # path inline
    text=text.replace(
        "require('path').resolve",
        "path.resolve"
    )

    if "path.resolve" in text and "node:path" not in text:
        text="import path from 'node:path';\n"+text


    # supabase
    text=text.replace(
        "const { createClient } = require('@supabase/supabase-js');",
        "import { createClient } from '@supabase/supabase-js';"
    )


    # ws
    text=text.replace(
        "WebSocket = require('ws');",
        "import WebSocket from 'ws';"
    )


    if text != original:
        file.write_text(text)
        print("Updated:", file)


print("Phase 3 complete")

PY
