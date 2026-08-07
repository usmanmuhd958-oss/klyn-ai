#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

OUT="architecture/audit/dependency-migration.txt"

mkdir -p architecture/audit
> "$OUT"

echo "[DEPENDENCY AUDIT] Searching old module references..."

echo "
===== WorkflowEngine =====
" >> "$OUT"

grep -R "kernel/workflow" \
--include="*.ts" \
--exclude-dir=node_modules \
--exclude-dir=.git \
. >> "$OUT" || true


echo "
===== MemoryEngine =====
" >> "$OUT"

grep -R "core/memory" \
--include="*.ts" \
--exclude-dir=node_modules \
--exclude-dir=.git \
. >> "$OUT" || true


echo "
===== AgentExecutor =====
" >> "$OUT"

grep -R "kernel/src/execution/agent_executor" \
--include="*.ts" \
--exclude-dir=node_modules \
--exclude-dir=.git \
. >> "$OUT" || true


echo "[DEPENDENCY AUDIT] Complete"
echo "Output: $OUT"
