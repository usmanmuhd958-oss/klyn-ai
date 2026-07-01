#!/bin/bash
set -euo pipefail

source core/multi_llm.sh

RAW_INPUT="${1:-}"

job_id="${RAW_INPUT%%::*}"
payload="${RAW_INPUT#*::}"

payload=$(echo "$payload" | sed 's/^[a-f0-9]\+::.* for: //g' || true)

mkdir -p runtime/vault

echo "[EXECUTOR] job=$job_id"

REVIEW=$(cat runtime/vault/review.txt 2>/dev/null || echo "NO_REVIEW_AVAILABLE")

PROMPT="You are a DevOps automation master.

Read the code review and generate a highly optimized deployment manifest.

REVIEW:
$REVIEW

TASK:
$payload

Return infrastructure-level deployment summary, optimizations, and rollout steps."

RESULT=$(call_deepseek "$PROMPT")

echo "$RESULT" > runtime/vault/manifest.txt

echo "[EXECUTOR] manifest saved"
