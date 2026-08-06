#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$PROJECT_ROOT/runtime/logs/autonomous_orchestrator.log"

log() { echo "[$(date -Iseconds)] $1" >> "$LOG"; }

while true; do
    log "=== Starting full autonomy cycle ==="

    # Step 1: Run code audit (shellcheck + shebang fixes)
    log "Step 1/5: Code audit..."
    bash "$PROJECT_ROOT/scripts/ai_code_review.sh" 2>/dev/null || true

    # Step 2: Autonomous code review with local AI
    log "Step 2/5: AI code review..."
    bash "$PROJECT_ROOT/agents/src/proactive_bug_hunter.sh" 2>/dev/null || true
    bash "$PROJECT_ROOT/agents/src/autonomous_code_fixer.sh" 2>/dev/null || true

    # Step 3: Self‑improvement (auto‑commit fixes)
    log "Step 3/5: Self‑improvement..."
    bash "$PROJECT_ROOT/agents/src/autonomous_improver.sh" 2>/dev/null || true

    # Step 4: Run tests
    log "Step 4/5: Running tests..."
    bash "$PROJECT_ROOT/agents/src/self_benchmark.sh" 2>/dev/null || true
    if bash "$PROJECT_ROOT/scripts/run_tests.sh" 2>/dev/null; then
        log "Tests passed."
    else
        log "Tests failed – rolling back changes..."
        cd "$PROJECT_ROOT" && git checkout -- . 2>/dev/null || true
        continue
    fi

    # Step 5: Commit & push if changes exist
    log "Step 5/5: Committing improvements..."
    cd "$PROJECT_ROOT"
    if ! git diff --quiet 2>/dev/null; then
        git add -A
        git commit -m "🤖 Autonomous improvement cycle – $(date -I)" || true
        git push origin main 2>/dev/null || true
        log "Changes committed and pushed."
    else
        log "No changes to commit."
    fi

    log "=== Full autonomy cycle complete ==="
    sleep 3600  # Run every hour
done
