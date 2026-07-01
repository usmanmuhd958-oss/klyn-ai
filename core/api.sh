#!/bin/bash
set -euo pipefail

LEDGER="runtime/ledger/jobs.jsonl"

mkdir -p runtime/ledger runtime/logs runtime/lock/pids

type="${1:-}"
payload="${2:-}"

if [[ -z "$type" || -z "$payload" ]]; then
  echo "[API] usage: ./core/api.sh <type> <payload>"
  exit 1
fi

# generate compact unique ID
id=$(date +%s%N | md5sum | head -c 8)

# validate type
case "$type" in
  plan|code|review|execute) ;;
  *)
    echo "[API] invalid type: $type"
    exit 1
  ;;
esac

# build strict JSON safely
job=$(jq -n \
  --arg id "$id" \
  --arg type "$type" \
  --arg payload "$payload" \
  '{
    id: $id,
    type: $type,
    payload: $payload,
    status: "pending",
    node: "local"
  }')

echo "$job" >> "$LEDGER"

echo "[API] job submitted → id=$id type=$type"
