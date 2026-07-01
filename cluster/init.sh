#!/data/data/com.termux/files/usr/bin/bash

mkdir -p runtime
mkdir -p runtime/locks

NODES="runtime/nodes.jsonl"
JOBS="runtime/jobs.jsonl"

# Ensure files exist
[ ! -f "$NODES" ] && touch "$NODES"
[ ! -f "$JOBS" ] && touch "$JOBS"

echo "[INIT] Cluster runtime initialized"
echo "[INIT] nodes.jsonl ready"
echo "[INIT] jobs.jsonl ready"
