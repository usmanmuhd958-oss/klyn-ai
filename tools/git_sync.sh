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
cd "$HOME/klyn-ai-os"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT_MSG="${1:-chore: automated synchronization}"

# ---------------------------------------------------------------------------
# 3. Stage all changes and commit
# ---------------------------------------------------------------------------
log_info "Staging all changes…"
git add .
if git commit -m "$COMMIT_MSG" --allow-empty 2>/dev/null; then
    log_ok "Commit created: $COMMIT_MSG"
else
    log_warn "Nothing to commit (working tree clean)."
fi

# ---------------------------------------------------------------------------
# 4. Store clean (tokenless) remote URLs for later restoration
# ---------------------------------------------------------------------------
CLEAN_GH_URL="https://github.com/usmanmuhd958-oss/klyn-ai.git"
CLEAN_GL_URL="https://gitlab.com/usmanmuhd958-oss/klyn-ai.git"

ORIGINAL_ORIGIN_URL=""
ORIGINAL_GITLAB_URL=""

if git remote get-url origin &>/dev/null; then
    ORIGINAL_ORIGIN_URL=$(git remote get-url origin)
fi
if git remote get-url gitlab &>/dev/null; then
    ORIGINAL_GITLAB_URL=$(git remote get-url gitlab)
fi

# ---------------------------------------------------------------------------
# 5. Cleanup trap – restore tokenless URLs when the script exits
# ---------------------------------------------------------------------------
cleanup_remotes() {
    if [ -n "$ORIGINAL_ORIGIN_URL" ]; then
        git remote set-url origin "$ORIGINAL_ORIGIN_URL" 2>/dev/null || true
    fi
    if [ -n "$ORIGINAL_GITLAB_URL" ]; then
        git remote set-url gitlab "$ORIGINAL_GITLAB_URL" 2>/dev/null || true
    fi
}
trap cleanup_remotes EXIT

# ---------------------------------------------------------------------------
# 6. Temporarily set authenticated URLs and push
# ---------------------------------------------------------------------------

# -- GitHub (origin) --
if [ -n "$GH_TOKEN" ] && git remote get-url origin &>/dev/null; then
    log_info "${ICON_SYNC} Pushing to GitHub (origin) on branch $BRANCH…"
    git remote set-url origin "https://${GH_TOKEN}@github.com/usmanmuhd958-oss/klyn-ai.git"
    if git push origin "$BRANCH" 2>&1; then
        log_ok "GitHub push successful."
    else
        log_err "GitHub push failed. Check your token and network."
    fi
fi

# -- GitLab (gitlab) --
if [ -n "$GL_TOKEN" ] && git remote get-url gitlab &>/dev/null; then
    log_info "${ICON_SYNC} Pushing to GitLab (gitlab) on branch $BRANCH…"
    git remote set-url gitlab "https://oauth2:${GL_TOKEN}@gitlab.com/usmanmuhd958-oss/klyn-ai.git"
    if git push gitlab "$BRANCH" 2>&1; then
        log_ok "GitLab push successful."
    else
        log_err "GitLab push failed. Check your token and network."
    fi
fi

echo ""
echo -e "${C_GREEN}${ICON_ROCKET} Git sync completed. Remotes restored to clean state.${C_RESET}"
