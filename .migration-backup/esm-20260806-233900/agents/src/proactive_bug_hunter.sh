#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$PROJECT_ROOT/runtime/logs/bug_hunter.log"
log() { echo "[$(date -Iseconds)] $1" >> "$LOG"; }

log "Starting proactive bug scan..."

# Scan for hardcoded secrets
log "Checking for hardcoded secrets..."
grep -rn "API_KEY.*=.*sk-" "$PROJECT_ROOT" --include="*.js" --include="*.sh" --include="*.ts" 2>/dev/null | grep -v node_modules | grep -v config/ai_keys.env | while read line; do
    log "⚠️ Potential hardcoded secret: $line"
done

# Scan for missing error handling in JS/TS
log "Checking for missing error handling..."
grep -rn "await fetch(" "$PROJECT_ROOT" --include="*.js" --include="*.ts" 2>/dev/null | grep -v node_modules | grep -v ".catch" | grep -v "try {" | while read line; do
    log "⚠️ Missing error handling for fetch: $line"
done

# Scan for eval() usage (dangerous)
log "Checking for eval() usage..."
grep -rn "eval(" "$PROJECT_ROOT" --include="*.js" --include="*.ts" 2>/dev/null | grep -v node_modules | while read line; do
    log "⚠️ eval() usage detected: $line"
done

log "Proactive bug scan complete."
