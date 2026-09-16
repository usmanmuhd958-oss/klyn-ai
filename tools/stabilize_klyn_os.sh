#!/usr/bin/env bash
set -euo pipefail

# --- Colors & Icons ---
readonly C_GREEN='\033[0;32m'; readonly C_YELLOW='\033[1;33m'; readonly C_RED='\033[0;31m'; readonly C_BLUE='\033[0;34m'; readonly C_RESET='\033[0m'
readonly ICON_OK="✅"; readonly ICON_WARN="⚠️"; readonly ICON_ERR="❌"; readonly ICON_ROCKET="🚀"

log_info()  { echo -e "${C_BLUE}ℹ${C_RESET}  $*"; }
log_ok()    { echo -e "${C_GREEN}${ICON_OK}${C_RESET} $*"; }
log_warn()  { echo -e "${C_YELLOW}${ICON_WARN}${C_RESET} $*"; }
log_err()   { echo -e "${C_RED}${ICON_ERR}${C_RESET} $*"; }

# Required runtime configuration must come from the environment/secret store.
: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?NEXT_PUBLIC_SUPABASE_ANON_KEY is required}"
: "${JWT_SECRET:?JWT_SECRET is required}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"

# Backward-compatible names for the local API implementation.
export SUPABASE_URL="${SUPABASE_URL:-$NEXT_PUBLIC_SUPABASE_URL}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$NEXT_PUBLIC_SUPABASE_ANON_KEY}"

# 1. Ensure required tools
for cmd in node npm jq curl; do
  if ! command -v "$cmd" &>/dev/null; then
    log_err "$cmd is required; refusing to install dependencies during CI."
    exit 1
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
  log_err "Missing dependencies: ${MISSING_PKGS[*]}"
  log_err "Dependency manifests are immutable in CI; update package.json and package-lock.json intentionally."
  exit 1
else
  log_ok "All required dependencies present in package.json."
fi

# 3. Local dry-run of health check (Termux-compatible paths)
LOG_DIR="${KLYN_LOG_DIR:-$HOME/tmp}"
mkdir -p "$LOG_DIR"

log_info "Starting local API server..."
node api/server.js > "$LOG_DIR/klyn_api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

HEALTH_OK=false
for i in $(seq 1 15); do
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

# 4. Git Sync Safety Gate
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  log_err "Uncommitted changes detected. Please commit or stash them before pushing."
  exit 1
fi

log_ok "Working tree clean. All tests passed. It is safe to push!"

echo ""
echo -e "${C_GREEN}${ICON_ROCKET} KLYN AI OS is stable and ready for CI/CD.${C_RESET}"
echo -e "   Push to GitHub/GitLab with confidence."
