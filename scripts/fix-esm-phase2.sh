#!/usr/bin/env bash
set -euo pipefail

python3 <<'PY'

from pathlib import Path

files = [
    Path("kernel/healer.ts"),
    Path("kernel/kernel-entry.ts"),
    Path("kernel/orchestrator.ts"),
    Path("kernel/src/services/local_llm_provider.ts"),
    Path("kernel/src/services/state_engine.ts"),
    Path("kernel/task-queue.ts"),
    Path("packages/workflow-engine/src/AdvancedWorkflowEngine.ts"),
]

for file in files:
    if not file.exists():
        continue

    text=file.read_text()

    original=text


    # fs inline
    text=text.replace(
        "require('fs').existsSync",
        "fs.existsSync"
    )

    text=text.replace(
        "require('fs').readFileSync",
        "fs.readFileSync"
    )


    # os
    text=text.replace(
        "require('os').cpus()",
        "os.cpus()"
    )

    text=text.replace(
        "require('os').loadavg()",
        "os.loadavg()"
    )


    if text != original:

        imports=[]

        if "fs." in text and "node:fs" not in text:
            imports.append("import fs from 'node:fs';")

        if "os." in text and "node:os" not in text:
            imports.append("import os from 'node:os';")


        if imports:
            text="\n".join(imports)+"\n\n"+text

        file.write_text(text)
        print("Fixed:", file)


print("Phase 2 complete")

PY
