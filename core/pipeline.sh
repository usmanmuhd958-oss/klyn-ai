#!/bin/bash
set -euo pipefail

API="./core/api.sh"

mkdir -p runtime/ledger runtime/logs runtime/workspace

REQUEST="${1:-}"

if [[ -z "$REQUEST" ]]; then
  echo "[PIPELINE][ERROR] No request provided"
  exit 1
fi

PIPELINE_ID=$(date +%s%N | md5sum | head -c 6)

echo "======================================"
echo "[PIPELINE] STARTED"
echo "[PIPELINE] ID: $PIPELINE_ID"
echo "[PIPELINE] TASK: $REQUEST"
echo "======================================"

run_phase() {
  local type="$1"
  local payload="$2"

  echo ""
  echo ">>> PHASE: $type"

  # SAFE API CALL (no pipefail crash)
  result=$($API "$type" "$PIPELINE_ID::$payload" || true)

  # -----------------------------
  # FIXED JOB ID EXTRACTION
  # -----------------------------
  # expected format:
  # [API] job submitted → id=9798afbc type=plan

  job_id=$(echo "$result" | grep -o 'id=[a-zA-Z0-9]*' | head -n1 | cut -d'=' -f2 || true)

  # DEBUG OUTPUT ALWAYS SAFE
  if [[ -z "$job_id" ]]; then
    echo "[PIPELINE][WARN] job_id extraction failed"
    echo "[PIPELINE][DEBUG] raw API output:"
    echo "$result"
  fi

  # HARD FAILURE IF STILL EMPTY
  if [[ -z "$job_id" ]]; then
    echo "[PIPELINE][ERROR] Cannot continue without job_id"
    exit 1
  fi

  echo "[PIPELINE] Job created: $job_id"
  echo "[PIPELINE] Waiting for completion..."

  while true; do
    status=$(grep "\"id\":\"$job_id\"" runtime/ledger/jobs.jsonl 2>/dev/null \
      | tail -n1 \
      | grep -o '"status":"[^"]*"' \
      | cut -d':' -f2 \
      | tr -d '"' || true)

    if [[ "$status" == "done" ]]; then
      echo "[PIPELINE] Phase $type completed"
      break
    fi

    if [[ "$status" == "failed" ]]; then
      echo "[PIPELINE][ERROR] Phase $type failed"
      exit 1
    fi

    sleep 2
  done
}

run_phase "plan"   "Plan for: $REQUEST"
run_phase "code"   "Write code for: $REQUEST"
run_phase "review" "Review code for: $REQUEST"
run_phase "execute" "Deploy: $REQUEST"

echo ""
echo "======================================"
echo "[PIPELINE] COMPLETED SUCCESSFULLY"
echo "======================================"
