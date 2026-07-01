#!/bin/bash
set -euo pipefail

source core/multi_llm.sh

RAW_INPUT="${1:-}"

# -----------------------------
# SAFE INPUT PARSING
# -----------------------------
job_id="${RAW_INPUT%%::*}"
payload="${RAW_INPUT#*::}"

# sanitize metadata noise
payload=$(echo "$payload" | sed 's/^[a-f0-9]\+::.* for: //g' || true)

mkdir -p runtime/vault

echo "[PLANNER] job=$job_id"

PROMPT="You are an elite enterprise software architect.

Design a massive multi-file system plan for the following request:
$payload

Return structured architecture, modules, and execution flow."

RESULT=$(call_gemini "$PROMPT")

echo "$RESULT" > runtime/vault/plan.txt

echo "[PLANNER] plan saved"
