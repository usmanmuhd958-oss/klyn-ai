#!/usr/bin/env bash
# =============================================================================
# KLYN AI OS – Authenticated Dual‑Push Engine (Termux Optimized)
# =============================================================================
set -euo pipefail

# Colors & Icons
readonly C_GREEN='\033[0;32m'; readonly C_YELLOW='\033[1;33m'; readonly C_RED='\033[0;31m'; readonly C_BLUE='\033[0;34m'; readonly C_RESET='\033[0m'
readonly ICON_OK="✅"; readonly ICON_ERR="❌"; readonly ICON_WARN="⚠️"; readonly ICON_SYNC="🔄"; readonly ICON_ROCKET="🚀"

log_info()  { echo -e "${C_BLUE}ℹ${C_RESET}  $*"; }
log_ok()    { echo -e "${C_GREEN}${ICON_OK}${C_RESET} $*"; }
log_warn()  { echo -e "${C_YELLOW}${ICON_WARN}${C_RESET} $*"; }
log_err()   { echo -e "${C_RED}${ICON_ERR}${C_RESET} $*"; }

# ---------------------------------------------------------------------------
# 1. Load tokens from environment (must already be exported)
# ---------------------------------------------------------------------------
GH_TOKEN="${GH_PERSONAL_TOKEN:-}"
GL_TOKEN="${GITLAB_ACCESS_TOKEN:-}"

if [ -z "$GH_TOKEN" ] && [ -z "$GL_TOKEN" ]; then
    log_err "No tokens found. Please run 'source tools/load_env.sh' first."
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Determine current branch and commit message
# ---------------------------------------------------------------------------
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT_MSG="${1:-chore: automated synchronization}"
if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="chore: automated synchronization"
fi

# ---------------------------------------------------------------------------
# 3. Stage all changes and commit
# ---------------------------------------------------------------------------
cd "$HOME/klyn-ai-os"

log_info "Staging all changes..."
git add .
if git commit -m "$COMMIT_MSG" --allow-empty; then
    log_ok "Commit created: $COMMIT_MSG"
else
    log_warn "Nothing to commit (working tree clean)."
fi

# ---------------------------------------------------------------------------
# 4. Push to GitHub (origin) using token in URL, without modifying stored remote
# ---------------------------------------------------------------------------
if [ -n "$GH_TOKEN" ]; then
    log_info "${ICON_SYNC} Pushing to GitHub (origin) on branch $BRANCH..."
    # Use -c to inject the token only for this push operation (no permanent change)
    if git -c "remote.origin.url=https://${GH_TOKEN}@github.com/usmanmuhd958-oss/klyn-ai.git" push origin "$BRANCH" 2>&1; then
        log_ok "GitHub push successful."
    else
        log_err "GitHub push failed. Check your token and network."
    fi
else
    log_warn "GH_PERSONAL_TOKEN not set – skipping GitHub push."
fi

# ---------------------------------------------------------------------------
# 5. Push to GitLab (gitlab) using token in URL
# ---------------------------------------------------------------------------
if [ -n "$GL_TOKEN" ]; then
    # Only push if the gitlab remote exists
    if git remote | grep -qx 'gitlab'; then
        log_info "${ICON_SYNC} Pushing to GitLab (gitlab) on branch $BRANCH..."
        if git -c "remote.gitlab.url=https://oauth2:${GL_TOKEN}@gitlab.com/usmanmuhd958-oss/klyn-ai.git" push gitlab "$BRANCH" 2>&1; then
            log_ok "GitLab push successful."
        else
            log_err "GitLab push failed. Check your token and network."
        fi
    else
        log_warn "No 'gitlab' remote configured. Skipping GitLab push."
    fi
else
    log_warn "GITLAB_ACCESS_TOKEN not set – skipping GitLab push."
fi

echo ""
echo -e "${C_GREEN}${ICON_ROCKET} Git sync completed.${C_RESET}"
