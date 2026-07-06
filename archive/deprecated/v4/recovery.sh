#!/data/data/com.termux/files/usr/bin/bash

echo "[RECOVERY v4] scanning system..."

QUEUE="runtime/v4/ledger/jobs.jsonl"

if [[ -f "$QUEUE" ]]; then
  echo "[RECOVERY] replaying last known jobs"
else
  echo "[RECOVERY] initializing fresh ledger"
  mkdir -p runtime/v4/ledger
  touch "$QUEUE"
fi
