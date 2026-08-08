#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$PROJECT_ROOT/runtime/logs/autonomous_code_fixer.log"
log() { echo "[$(date -Iseconds)] $1" >> "$LOG"; }

fix_file() {
    local file="$1"
    local content=$(cat "$file" 2>/dev/null)
    [ -z "$content" ] && return

    log "Analyzing $file with local AI..."
    local prompt="Review this code. Return ONLY a unified diff patch with fixes, or 'NO_ISSUES_FOUND' if perfect.\n\n$content"
    local result=$(node "$PROJECT_ROOT/kernel/src/services/deepseek_coder_provider.js" "$prompt" 2>/dev/null)

    if [ "$result" = "NO_ISSUES_FOUND" ]; then
        log "✅ No issues in $file"
        return
    fi

    if [ -n "$result" ]; then
        echo "$result" > /tmp/klyn_fix.diff
        if patch --dry-run "$file" /tmp/klyn_fix.diff 2>/dev/null; then
            patch "$file" /tmp/klyn_fix.diff
            log "🔧 Fixed: $file"
        else
            log "⚠️ Patch rejected: $file"
        fi
        rm /tmp/klyn_fix.diff
    fi
}

log "Starting autonomous code fixing cycle..."
for project in $(ls "$PROJECT_ROOT/projects" 2>/dev/null | grep -v templates); do
    find "$PROJECT_ROOT/projects/$project" -type f \( -name "*.js" -o -name "*.py" -o -name "*.sh" \) 2>/dev/null | while read file; do
        fix_file "$file"
    done
done

log "Autonomous code fixing cycle complete."
