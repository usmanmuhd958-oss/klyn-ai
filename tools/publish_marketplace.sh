#!/usr/bin/env bash
set -euo pipefail

readonly C_GREEN='\033[0;32m'; readonly C_YELLOW='\033[1;33m'; readonly C_RED='\033[0;31m'; readonly C_RESET='\033[0m'
readonly ICON_OK="✅"; readonly ICON_ERR="❌"; readonly ICON_WARN="⚠️"

log_info() { echo -e "${C_GREEN}${ICON_OK}${C_RESET} $*"; }
log_warn() { echo -e "${C_YELLOW}${ICON_WARN}${C_RESET} $*"; }
log_err()  { echo -e "${C_RED}${ICON_ERR}${C_RESET} $*"; }

TOKEN="${GH_PERSONAL_TOKEN:-}"
if [ -z "$TOKEN" ]; then
    log_err "GH_PERSONAL_TOKEN is not set."
    exit 1
fi

SOURCE_DIR="${SOURCE_DIR:-plugins/marketplace/public}"
REPO="github.com/usmanmuhd958-oss/klyn-ai.git"
REMOTE_URL="https://usmanmuhd958-oss:${TOKEN}@${REPO}"

if [ ! -d "$SOURCE_DIR" ]; then
    mkdir -p "$SOURCE_DIR"
    echo '<html><body><h1>Klyn AI OS Marketplace</h1><p>Coming soon.</p></body></html>' > "$SOURCE_DIR/index.html"
    echo '{}' > "$SOURCE_DIR/index.json"
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

log_info "Preparing marketplace files..."
cp -r "$SOURCE_DIR"/* "$TMP_DIR" 2>/dev/null || {
    echo '<html><body><h1>Klyn AI OS Marketplace</h1><p>No plugins yet.</p></body></html>' > "$TMP_DIR/index.html"
}

cd "$TMP_DIR"
git init -q
git checkout -b gh-pages
git add -A
git commit -q -m "🌐 Publish Klyn AI OS Plugin Marketplace"

log_info "Pushing to GitHub Pages..."
if git push --force "$REMOTE_URL" gh-pages 2>&1; then
    log_info "Marketplace successfully published!"
    echo "   🌐 https://usmanmuhd958-oss.github.io/klyn-ai"
else
    log_err "Push failed. Check your token and internet connection."
    exit 1
fi
