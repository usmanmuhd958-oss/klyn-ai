#!/bin/bash
set -euo pipefail

echo "[BOOTSTRAP] Creating KLYN OS v6 filesystem..."

mkdir -p kernel/v6/core
mkdir -p kernel/v6/scheduler
mkdir -p kernel/v6/cluster
mkdir -p kernel/v6/recovery
mkdir -p runtime/ledger
mkdir -p runtime/cluster
mkdir -p runtime/lock
mkdir -p runtime/logs
mkdir -p agents
mkdir -p output

touch runtime/ledger/jobs.jsonl
touch runtime/cluster/nodes.jsonl
touch runtime/logs/events.jsonl
touch runtime/lock/scheduler.lock

echo "[BOOTSTRAP] DONE"
