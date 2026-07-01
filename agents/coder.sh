#!/bin/bash
set -euo pipefail

source core/multi_llm.sh

RAW_INPUT="${1:-}"

job_id="${RAW_INPUT%%::*}"
payload="${RAW_INPUT#*::}"

payload=$(echo "$payload" | sed 's/^[a-f0-9]\+::.* for: //g' || true)

mkdir -p runtime/vault

echo "[CODER] job=$job_id"

PLAN=$(cat runtime/vault/plan.txt 2>/dev/null || echo "NO_PLAN_AVAILABLE")

PROMPT="You are a world-class production software engineer.

Read the architecture plan and write flawless, production-ready code.

ARCHITECTURE:
$PLAN

TASK:
$payload

Return clean, deployable implementation."

RESULT=$(call_claude "$PROMPT")

echo "$RESULT" > runtime/vault/code.txt

echo "[CODER] code saved"
