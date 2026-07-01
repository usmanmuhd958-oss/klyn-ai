#!/bin/bash
set -euo pipefail

API="./core/api.sh"

INPUT="${1:-}"

if [[ -z "$INPUT" ]]; then
  echo "[ROUTER][ERROR] No input provided."
  exit 1
fi

echo "[ROUTER] Incoming prompt: $INPUT"

# Normalize input to lowercase for matching
LOWER_INPUT=$(echo "$INPUT" | tr '[:upper:]' '[:lower:]')

TYPE="plan"
REASON="default fallback (no keyword match)"

# ================================
# INTENT CLASSIFICATION ENGINE
# ================================

# PLAN
if echo "$LOWER_INPUT" | grep -Eq "plan|strategy|checklist|design|steps|architecture"; then
  TYPE="plan"
  REASON="matched planning keywords"

# CODE
elif echo "$LOWER_INPUT" | grep -Eq "write code|script|function|program|backend|frontend|implement|api"; then
  TYPE="code"
  REASON="matched coding keywords"

# REVIEW
elif echo "$LOWER_INPUT" | grep -Eq "check|review|audit|validate|syntax|debug|inspect"; then
  TYPE="review"
  REASON="matched review keywords"

# EXECUTE
elif echo "$LOWER_INPUT" | grep -Eq "run|deploy|execute|start|launch|boot|init"; then
  TYPE="execute"
  REASON="matched execution keywords"
fi

echo "[ROUTER] Classified intent → TYPE=$TYPE ($REASON)"

# ================================
# DISPATCH TO KERNEL API
# ================================
OUTPUT=$("$API" "$TYPE" "$INPUT")

JOB_ID=$(echo "$OUTPUT" | grep -Eo '[0-9a-f]{6,16}' | head -n 1)

if [[ -z "$JOB_ID" ]]; then
  JOB_ID="unknown"
fi

echo "[ROUTER] Job submitted successfully"
echo "[ROUTER] Type   : $TYPE"
echo "[ROUTER] Reason : $REASON"
echo "[ROUTER] Job ID  : $JOB_ID"

exit 0
