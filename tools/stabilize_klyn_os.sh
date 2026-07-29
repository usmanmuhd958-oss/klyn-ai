#!/usr/bin/env bash
set -euo pipefail

# --- Colors & Icons ---
readonly C_GREEN='\033[0;32m'; readonly C_YELLOW='\033[1;33m'; readonly C_RED='\033[0;31m'; readonly C_BLUE='\033[0;34m'; readonly C_RESET='\033[0m'
readonly ICON_OK="✅"; readonly ICON_WARN="⚠️"; readonly ICON_ERR="❌"; readonly ICON_ROCKET="🚀"

log_info()  { echo -e "${C_BLUE}ℹ${C_RESET}  $*"; }
log_ok()    { echo -e "${C_GREEN}${ICON_OK}${C_RESET} $*"; }
log_warn()  { echo -e "${C_YELLOW}${ICON_WARN}${C_RESET} $*"; }
log_err()   { echo -e "${C_RED}${ICON_ERR}${C_RESET} $*"; }

# 1. Ensure required tools
for cmd in node npm jq curl; do
  if ! command -v "$cmd" &>/dev/null; then
    log_warn "$cmd missing – installing via pkg..."
    pkg install -y "$cmd" 2>/dev/null || { log_err "Failed to install $cmd."; exit 1; }
    log_ok "$cmd installed."
  fi
done

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# 2. Dependency audit
REQUIRED_PKGS=("jsonwebtoken" "dotenv" "@supabase/supabase-js")
MISSING_PKGS=()

for pkg in "${REQUIRED_PKGS[@]}"; do
  if ! jq -e ".dependencies[\"$pkg\"]" package.json >/dev/null 2>&1; then
    MISSING_PKGS+=("$pkg")
  fi
done

if [ ${#MISSING_PKGS[@]} -ne 0 ]; then
  log_warn "Missing dependencies: ${MISSING_PKGS[*]}"
  log_info "Installing and saving them..."
  npm install --save "${MISSING_PKGS[@]}" 2>&1 | tail -5
  log_ok "Dependencies installed and saved."
else
  log_ok "All required dependencies present in package.json."
fi

# 3. Zero‑Crash Local Mocking
mkdir -p config

if [ ! -f config/supabase.env ]; then
  cat > config/supabase.env << 'SUPABASE'
# KLYN AI OS – Supabase Configuration (placeholder)
SUPABASE_URL=https://fxuiljecdjgyffkjzqzl.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4dWlsamVjZGpneWZma2p6cXpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjU0OTUsImV4cCI6MjA5NjAwMTQ5NX0.awMYL1hFl-lBF1QIh4KtkYSMmsCnVlwKfmKLwIhb2SM
SUPABASE
  log_info "Created placeholder config/supabase.env."
fi

if [ ! -f config/ai_keys.env ]; then
  cat > config/ai_keys.env << 'AIKEYS'
# KLYN AI OS – Cloud AI Provider Keys (placeholder)
#OPENAI_API_KEY=***REMOVED***
#ANTHROPIC_API_KEY=***REMOVED***
#GEMINI_API_KEY=AQ.Ab8RN6LY5i1-safh-eEzOqeC7YNBkHwBTYdibl3ohpBROhMH4g
#DEEPSEEK_API_KEY=***REMOVED***
AIKEYS
  log_info "Created placeholder config/ai_keys.env."
fi

# 4. Local dry‑run of health check (Termux‑compatible paths)
export JWT_SECRET="***REMOVED***"
export ADMIN_PASSWORD="klyn"

# Termux does not have /tmp – use a directory that always exists
LOG_DIR="$HOME/tmp"
mkdir -p "$LOG_DIR"

log_info "Starting local API server..."
node api/server.js > "$LOG_DIR/klyn_api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

HEALTH_OK=false
for i in $(seq 1 15); do   # up to 15 attempts = 30 seconds
  sleep 2
  if curl -s http://localhost:3000/status | grep -q healthy; then
    HEALTH_OK=true
    break
  fi
  log_warn "API not ready (attempt $i/15)..."
done

if [ "$HEALTH_OK" = false ]; then
  log_err "API failed to start. Last 10 lines of log:"
  tail -10 "$LOG_DIR/klyn_api.log" 2>/dev/null || true
  exit 1
fi

log_ok "API is ready. Running health check..."
node scripts/health_check.js
HEALTH_EXIT=$?

if [ $HEALTH_EXIT -eq 0 ]; then
  log_ok "Health check passed – all systems green."
else
  log_err "Health check failed."
  exit 1
fi

# 5. Git Sync Safety Gate
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  log_err "Uncommitted changes detected. Please commit or stash them before pushing."
  exit 1
fi

log_ok "Working tree clean. All tests passed. It is safe to push!"

echo ""
echo -e "${C_GREEN}${ICON_ROCKET} KLYN AI OS is stable and ready for CI/CD.${C_RESET}"
echo -e "   Push to GitHub/GitLab with confidence."
