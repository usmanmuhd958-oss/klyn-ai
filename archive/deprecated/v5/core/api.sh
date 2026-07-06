#!/bin/bash

LEDGER="runtime/v5/ledger/jobs.jsonl"

submit_job() {
  local type="$1"
  local payload="$2"
  local node="${3:-local}"

  mkdir -p runtime/v5/ledger

  echo "{\"id\":\"$(date +%s%N)\",\"type\":\"$type\",\"payload\":\"$payload\",\"node\":\"$node\",\"status\":\"pending\"}" >> "$LEDGER"

  echo "[V5 API] job submitted → $type"
}
