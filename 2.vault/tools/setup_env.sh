#!/usr/bin/env bash
# =============================================================================
# KLYN AI OS – Enterprise Secret Setup (Termux Optimized)
# =============================================================================
set -euo pipefail

# -- Paths -----------------------------------------------------------------
readonly ENV_FILE="$HOME/klyn-ai-os/.env"
readonly GITIGNORE_FILE="$HOME/klyn-ai-os/.gitignore"

# -- Colors & Icons --------------------------------------------------------
readonly C_GREEN='\033[0;32m'; readonly C_YELLOW='\033[1;33m'; readonly C_BLUE='\033[0;34m'; readonly C_RED='\033[0;31m'; readonly C_RESET='\033[0m'
readonly ICON_OK="✅"; readonly ICON_WARN="⚠️"; readonly ICON_KEY="🔑"; readonly ICON_ROCKET="🚀"

log_info()  { echo -e "${C_BLUE}ℹ${C_RESET}  $*"; }
log_ok()    { echo -e "${C_GREEN}${ICON_OK}${C_RESET} $*"; }
log_warn()  { echo -e "${C_YELLOW}${ICON_WARN}${C_RESET} $*"; }
log_err()   { echo -e "${C_RED}❌${C_RESET} $*"; }

# -- Helper: generate a secure random JWT secret ---------------------------
generate_jwt_secret() {
    if command -v openssl &>/dev/null; then
        openssl rand -hex 16          # 32 hex characters (128-bit)
    elif command -v node &>/dev/null; then
        node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
    else
        echo "klyn-auto-$(date +%s%N)-$RANDOM"  # fallback
    fi
}

# -- Helper: read a value from the user ------------------------------------
read_secret() {
    local prompt="$1"
    local varname="$2"
    local default="${3:-}"
    local input
    read -r -p "$prompt: " input
    input="${input:-$default}"
    eval "$varname='$input'"
}

# -- Main -------------------------------------------------------------------
echo -e "${C_BLUE}${ICON_KEY} KLYN AI OS – Secret & Environment Manager${C_RESET}"
echo ""

# Warn if .env already exists
if [ -f "$ENV_FILE" ]; then
    log_warn "Existing .env file found."
    read -r -p "Overwrite it? (y/N) " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Keeping existing .env. Exiting."
        exit 0
    fi
fi

log_info "Please enter the following keys (press Enter to skip optional ones):"
echo ""

# Collect keys
read_secret "GitLab Personal Access Token (api scope)"       GITLAB_ACCESS_TOKEN ""
read_secret "GitHub Personal Access Token (repo, workflow)"  GH_PERSONAL_TOKEN   ""
read_secret "JWT Secret (leave empty to auto-generate)"      JWT_SECRET          ""
if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET=$(generate_jwt_secret)
    log_info "Generated JWT_SECRET (keep it safe): $JWT_SECRET"
fi
read_secret "OpenAI API Key (GPT-5.5 Pro)"   OPENAI_API_KEY    ""
read_secret "DeepSeek API Key"               DEEPSEEK_API_KEY  ""
read_secret "Gemini API Key"                 GEMINI_API_KEY    ""
read_secret "Claude / Anthropic API Key"     CLAUDE_API_KEY    ""
read_secret "Supabase URL (https://...supabase.co)" SUPABASE_URL ""

# -- Atomic write with restricted permissions --------------------------------
log_info "Writing .env file..."
TMP_FILE="${ENV_FILE}.tmp.$$"
cat > "$TMP_FILE" <<ENVEOF
GITLAB_ACCESS_TOKEN=${GITLAB_ACCESS_TOKEN}
GH_PERSONAL_TOKEN=${GH_PERSONAL_TOKEN}
JWT_SECRET=${JWT_SECRET}
OPENAI_API_KEY=${OPENAI_API_KEY}
DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
GEMINI_API_KEY=${GEMINI_API_KEY}
CLAUDE_API_KEY=${CLAUDE_API_KEY}
SUPABASE_URL=${SUPABASE_URL}
ENVEOF
mv "$TMP_FILE" "$ENV_FILE"
chmod 600 "$ENV_FILE"
log_ok "Secrets saved to .env (permissions: 600)."

# -- Add .env to .gitignore (if not already) ---------------------------------
if [ -f "$GITIGNORE_FILE" ]; then
    if ! grep -qxF ".env" "$GITIGNORE_FILE"; then
        echo ".env" >> "$GITIGNORE_FILE"
        log_ok ".env added to .gitignore – safe from accidental commits."
    else
        log_info ".env already in .gitignore."
    fi
else
    echo ".env" > "$GITIGNORE_FILE"
    log_ok "Created .gitignore with .env entry."
fi

echo ""
echo -e "${C_GREEN}${ICON_ROCKET} Setup complete.${C_RESET}"
echo "   ➤ To load secrets: source tools/load_env.sh"
echo "   ➤ To verify: printenv | grep -E 'TOKEN|SECRET|API_KEY|SUPABASE_URL'"
