#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

# =========================
# CONFIG (EDIT HERE ONLY)
# =========================
SUPABASE_URL="https://fxuiljecdjgyffkjzqzl.supabase.co"
SUPABASE_ANON_KEY="PASTE_YOUR_ANON_KEY_HERE"

# =========================
# LOGGING SYSTEM
# =========================
LOG_DIR="runtime/logs"
mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SUPABASE] [$1] $2"
}

# =========================
# DEPENDENCY CHECK
# =========================
command -v curl >/dev/null 2>&1 || {
  log "ERROR" "curl not installed"
  exit 1
}

command -v jq >/dev/null 2>&1 || {
  log "ERROR" "jq not installed"
  exit 1
}

# =========================
# VALIDATION
# =========================
if [[ -z "$SUPABASE_URL" ]]; then
  log "ERROR" "SUPABASE_URL missing"
  exit 1
fi

if [[ -z "$SUPABASE_ANON_KEY" ]]; then
  log "ERROR" "SUPABASE_ANON_KEY missing"
  exit 1
fi

# =========================
# CORE REQUEST FUNCTION
# =========================
supabase_get() {
  local endpoint="$1"
  local url="${SUPABASE_URL}${endpoint}"
  local tmp
  tmp=$(mktemp)

  log "INFO" "GET $endpoint"

  HTTP_CODE=$(curl -sS --max-time 30 \
    -o "$tmp" \
    -w "%{http_code}" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    "$url")

  log "INFO" "HTTP $HTTP_CODE"

  if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "204" ]]; then
    log "ERROR" "Request failed"
    cat "$tmp"
    rm -f "$tmp"
    return 1
  fi

  if [[ -s "$tmp" ]]; then
    cat "$tmp" | jq '.'
  else
    echo "{}"
  fi

  rm -f "$tmp"
}

# =========================
# TEST CONNECTION
# =========================
log "INFO" "Initializing Supabase connection"

supabase_get "/rest/v1/" || {
  log "ERROR" "Connection failed"
  exit 1
}

log "SUCCESS" "Supabase client ready"
