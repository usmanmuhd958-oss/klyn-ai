#!/data/data/com.termux/files/usr/bin/bash

set -e


OUT="architecture/audit/class-duplicates.txt"

mkdir -p architecture/audit

> "$OUT"


for name in AgentRuntime AIEngine WorkflowEngine MemoryEngine AgentExecutor
do

echo "===== $name =====" >> "$OUT"

grep -R "class $name" \
packages kernel intelligence core agents \
--include="*.ts" \
--exclude-dir=node_modules \
>> "$OUT" || true

echo >> "$OUT"

done


echo "Audit complete: $OUT"
