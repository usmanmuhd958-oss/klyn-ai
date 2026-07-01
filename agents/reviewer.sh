#!/bin/bash
set -euo pipefail

source core/multi_llm.sh

RAW_INPUT="${1:-}"

job_id="${RAW_INPUT%%::*}"
payload="${RAW_INPUT#*::}"

payload=$(echo "$payload" | sed 's/^[a-f0-9]\+::.* for: //g' || true)

mkdir -p runtime/vault

echo "[REVIEWER] job=$job_id"

CODE=$(cat runtime/vault/code.txt 2>/dev/null || echo "NO_CODE_AVAILABLE")

PROMPT="You are a lead security auditor and code reviewer.

Perform an intensive review of the following code.

You MUST start your response with:
STATUS: PASS or STATUS: FAIL

CODE:
$CODE

TASK:
$payload"

RESULT=$(call_gpt "$PROMPT")

echo "$RESULT" > runtime/vault/review.txt

echo "[REVIEWER] review saved"
