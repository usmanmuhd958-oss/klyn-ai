#!/usr/bin/env bash
set -euo pipefail

# =========================
# KLYN AI OS v6 ORCHESTRATOR (Swarm v7 Control Loop)
# =========================

BASE_DIR="$(pwd)"
AGENTS_DIR="$BASE_DIR/agents"
VAULT_DIR="$BASE_DIR/runtime/vault"

mkdir -p "$VAULT_DIR"

# -------------------------
# Logging
# -------------------------
log() {
  local level="$1"
  local msg="$2"
  echo -e "[$level] $msg"
}

# -------------------------
# Generate Job ID
# -------------------------
gen_id() {
  head /dev/urandom | tr -dc 'a-f0-9' | head -c 8
}

JOB_ID="$(gen_id)"
PAYLOAD="${1:-}"

if [[ -z "$PAYLOAD" ]]; then
  log "ERROR" "No payload provided"
  exit 1
fi

log "INFO" "🚀 Starting Swarm v7 Orchestration"
log "INFO" "Job ID: $JOB_ID"
log "INFO" "Payload: $PAYLOAD"

# -------------------------
# Run Planner
# -------------------------
log "INFO" "🧠 Planner (Gemini) executing..."
"$AGENTS_DIR/planner.sh" "$JOB_ID::$PAYLOAD"

# -------------------------
# Run Coder + Reviewer Loop
# -------------------------
RETRY=0
MAX_RETRY=3
STATUS="FAIL"

while [[ $RETRY -le $MAX_RETRY ]]; do

  log "INFO" "💻 Coder (Claude) attempt $((RETRY+1))..."
  "$AGENTS_DIR/coder.sh" "$JOB_ID::$PAYLOAD"

  log "INFO" "🔍 Reviewer (GPT) analyzing..."
  "$AGENTS_DIR/reviewer.sh" "$JOB_ID::$PAYLOAD"

  if [[ -f "$VAULT_DIR/review.txt" ]]; then
    REVIEW="$(cat "$VAULT_DIR/review.txt")"
  else
    REVIEW="STATUS: FAIL"
  fi

  echo "----------------------------------"
  echo "$REVIEW"
  echo "----------------------------------"

  if echo "$REVIEW" | grep -q "STATUS: PASS"; then
    STATUS="PASS"
    log "INFO" "✅ Review passed. Proceeding to executor..."
    break
  fi

  log "WARN" "⚠️ Review failed. Initiating self-heal cycle..."
  RETRY=$((RETRY+1))

  if [[ $RETRY -gt $MAX_RETRY ]]; then
    log "ERROR" "❌ Max retries reached. Aborting pipeline."
    exit 1
  fi

done

# -------------------------
# Executor Phase
# -------------------------
if [[ "$STATUS" == "PASS" ]]; then
  log "INFO" "⚙️ Executor (DeepSeek) deploying..."
  "$AGENTS_DIR/executor.sh" "$JOB_ID::$PAYLOAD"
  log "INFO" "🎉 Pipeline completed successfully for job $JOB_ID"
else
  log "ERROR" "Pipeline terminated without success"
  exit 1
fi

