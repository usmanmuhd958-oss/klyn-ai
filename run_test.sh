#!/usr/bin/env bash
set -euo pipefail

# =====================================================
# KLYN AI OS v7 - Automated QA Test Runner
# =====================================================

ORCH="./core/orchestrator.sh"
VAULT="./runtime/vault"

mkdir -p "$VAULT"

# -----------------------------
# Neon UI Helpers
# -----------------------------
hr() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

info() {
  echo -e "🟢 [INFO] $1"
}

warn() {
  echo -e "🟡 [WARN] $1"
}

error() {
  echo -e "🔴 [ERROR] $1"
}

# -----------------------------
# API Key Validation
# -----------------------------
check_keys() {
  local missing=0

  hr
  echo "🔐 VALIDATING ENVIRONMENT KEYS"
  hr

  if [[ -z "${GEMINI_API_KEY:-}" ]]; then
    error "GEMINI_API_KEY is missing"
    echo "👉 Fix: export GEMINI_API_KEY='your_key_here'"
    missing=1
  else
    info "GEMINI_API_KEY OK"
  fi

  if [[ -z "${CLAUDE_API_KEY:-}" ]]; then
    error "CLAUDE_API_KEY is missing"
    echo "👉 Fix: export CLAUDE_API_KEY='your_key_here'"
    missing=1
  else
    info "CLAUDE_API_KEY OK"
  fi

  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    error "OPENAI_API_KEY is missing"
    echo "👉 Fix: export OPENAI_API_KEY='your_key_here'"
    missing=1
  else
    info "OPENAI_API_KEY OK"
  fi

  if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
    error "DEEPSEEK_API_KEY is missing"
    echo "👉 Fix: export DEEPSEEK_API_KEY='your_key_here'"
    missing=1
  else
    info "DEEPSEEK_API_KEY OK"
  fi

  hr

  if [[ "$missing" -eq 1 ]]; then
    error "Environment not ready. Aborting test."
    exit 1
  fi

  info "All API keys validated successfully"
}

# -----------------------------
# Run Full Orchestrator Test
# -----------------------------
run_test() {
  hr
  echo "🚀 STARTING KLYN AI OS v7 INTEGRATION TEST"
  hr

  TEST_PAYLOAD="Build a highly secure, lightweight Node.js/Express API routing system for a customer support application called Veltrix AI, with JWT authentication and custom rate-limiting."

  info "Test payload initialized"
  echo "🧠 Payload:"
  echo "$TEST_PAYLOAD"
  hr

  "$ORCH" "$TEST_PAYLOAD"

  hr
  info "Orchestrator execution complete"
  hr
}

# -----------------------------
# Vault Diagnostics
# -----------------------------
check_vault() {
  hr
  echo "📦 VAULT ARTIFACT ANALYSIS"
  hr

  FILES=("plan.txt" "code.txt" "review.txt" "manifest.txt")

  for f in "${FILES[@]}"; do
    FILE="$VAULT/$f"

    if [[ -f "$FILE" ]]; then
      SIZE=$(wc -c < "$FILE" || echo 0)
      echo "✅ $f -> EXISTS (${SIZE} bytes)"
    else
      echo "❌ $f -> MISSING"
    fi
  done

  hr
}

# -----------------------------
# MAIN EXECUTION FLOW
# -----------------------------
clear

echo "🌌 ====================================="
echo "   KLYN AI OS v7 - QA TEST RUNNER"
echo "🌌 ====================================="

check_keys
run_test
check_vault

echo ""
echo "🎉 TEST COMPLETE - SYSTEM DIAGNOSTICS FINISHED"
echo "🌌 ====================================="
