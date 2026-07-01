#!/bin/bash

LEDGER="runtime/v5/ledger/jobs.jsonl"

echo "[V5 RECOVERY] scanning ledger..."

if [[ -f "$LEDGER" ]]; then
  echo "[V5 RECOVERY] ledger exists → replay mode enabled"
else
  mkdir -p runtime/v5/ledger
  touch "$LEDGER"
  echo "[V5 RECOVERY] fresh start initialized"
fi
