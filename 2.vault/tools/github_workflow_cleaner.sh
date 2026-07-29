#!/usr/bin/env bash
set -euo pipefail

readonly C_GREEN='\033[0;32m'
readonly C_YELLOW='\033[1;33m'
readonly C_RED='\033[0;31m'
readonly C_BLUE='\033[0;34m'
readonly C_RESET='\033[0m'
readonly ICON_OK="✅"
readonly ICON_WARN="⚠️"
readonly ICON_ERR="❌"
readonly ICON_CLEAN="🧹"

log_info()  { echo -e "${C_BLUE}ℹ${C_RESET}  $*"; }
log_ok()    { echo -e "${C_GREEN}${ICON_OK}${C_RESET} $*"; }
log_warn()  { echo -e "${C_YELLOW}${ICON_WARN}${C_RESET} $*"; }
log_err()   { echo -e "${C_RED}${ICON_ERR}${C_RESET} $*"; }

for dep in curl jq; do
  if ! command -v "$dep" &>/dev/null; then
    log_warn "$dep not found – installing via pkg..."
    pkg install -y "$dep" >/dev/null 2>&1 || {
      log_err "Failed to install $dep. Please install it manually."
      exit 1
    }
    log_ok "$dep installed."
  fi
done

REPO="usmanmuhd958-oss/klyn-ai"
TOKEN="${GH_PERSONAL_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  log_err "GH_PERSONAL_TOKEN is not set."
  echo "   Please run: export GH_PERSONAL_TOKEN='your_token'"
  exit 1
fi

API_BASE="https://api.github.com/repos/$REPO/actions/runs"
AUTH_HEADER="Authorization: token $TOKEN"
ACCEPT_HEADER="Accept: application/vnd.github+json"

log_info "${ICON_CLEAN} Cancelling active runs..."

for status in queued in_progress; do
  page=1
  while : ; do
    data=$(curl -s --max-time 30 -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" \
      "$API_BASE?status=$status&branch=main&per_page=100&page=$page" 2>&1) || {
      log_err "GitHub API request failed (status=$status, page=$page)."
      break
    }
    runs=$(echo "$data" | jq -r '.workflow_runs[]? | "\(.id) \(.status)"' 2>/dev/null)
    [ -z "$runs" ] && break
    while read -r run_id run_status; do
      [ -z "$run_id" ] && continue
      log_info "Cancelling run #$run_id ($run_status)..."
      curl -s --max-time 15 -X POST -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" \
        "$API_BASE/$run_id/cancel" >/dev/null 2>&1 && \
        log_ok "Run #$run_id cancelled." || log_err "Failed to cancel run #$run_id."
    done <<< "$runs"
    page=$((page + 1))
  done
done

log_info "${ICON_CLEAN} Deleting old failed/cancelled/timed_out runs..."

page=1
while : ; do
  data=$(curl -s --max-time 30 -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" \
    "$API_BASE?status=completed&branch=main&per_page=100&page=$page" 2>&1) || {
    log_err "GitHub API request failed (page=$page)."
    break
  }
  runs=$(echo "$data" | jq -r \
    '.workflow_runs[]? | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out") | "\(.id) \(.conclusion)"' 2>/dev/null)
  [ -z "$runs" ] && break
  while read -r run_id conclusion; do
    [ -z "$run_id" ] && continue
    log_info "Deleting run #$run_id ($conclusion)..."
    http_code=$(curl -s --max-time 15 -X DELETE -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" \
      "$API_BASE/$run_id" -w "%{http_code}" -o /dev/null 2>&1)
    if [ "$http_code" = "204" ]; then
      log_ok "Run #$run_id deleted."
    else
      log_err "Failed to delete run #$run_id (HTTP $http_code)."
    fi
  done <<< "$runs"
  page=$((page + 1))
done

log_ok "All done – your GitHub Actions dashboard is clean."
