#!/usr/bin/env bash
# KLYN AI OS – Environment Setup & Secure Launcher
set -euo pipefail

# ── Colors & Icons ──────────────────────────────────────────────
C_GREEN='\033[0;32m'   C_YELLOW='\033[1;33m'   C_RED='\033[0;31m'   C_BLUE='\033[0;34m'   C_RESET='\033[0m'
ICON_OK="✅" ICON_WARN="⚠️" ICON_ERR="❌" ICON_KEY="🔑" ICON_ROCKET="🚀"

log_info()  { echo -e "${C_BLUE}ℹ${C_RESET}  $*"; }
log_ok()    { echo -e "${C_GREEN}${ICON_OK}${C_RESET} $*"; }
log_warn()  { echo -e "${C_YELLOW}${ICON_WARN}${C_RESET} $*"; }
log_err()   { echo -e "${C_RED}${ICON_ERR}${C_RESET} $*"; }

# ── Root directory ──────────────────────────────────────────────
ROOT="${HOME}/klyn-ai-os"
mkdir -p "$ROOT"
cd "$ROOT"

# ── 1. Prerequisite Validation ──────────────────────────────────
log_info "Checking prerequisites..."

# Node.js v22+
if command -v node >/dev/null; then
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 22 ]; then
    log_ok "Node.js $(node -v)"
  else
    log_err "Node.js version must be >= 22 (current: $(node -v)). Install via pkg install nodejs."
    exit 1
  fi
else
  log_err "Node.js is not installed. Run: pkg install nodejs"
  exit 1
fi

# Git
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  log_warn "Git repository not initialized."
  read -r -p "Initialize Git here and make initial commit? (y/N) " GIT_INIT
  if [[ "$GIT_INIT" =~ ^[Yy]$ ]]; then
    git init
    git add -A
    git commit -m "Initial commit – KLYN AI OS"
    log_ok "Git repository initialized and initial commit created."
  else
    log_info "Skipping Git initialization."
  fi
else
  log_ok "Git repository detected."
fi

# Required system tools (nano, curl, pkg)
MISSING_TOOLS=()
for tool in nano curl pkg; do
  if ! command -v "$tool" >/dev/null; then
    MISSING_TOOLS+=("$tool")
  fi
done
if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
  log_warn "Missing tools: ${MISSING_TOOLS[*]}"
  read -r -p "Install them automatically via pkg? (y/N) " INSTALL_TOOLS
  if [[ "$INSTALL_TOOLS" =~ ^[Yy]$ ]]; then
    pkg install -y "${MISSING_TOOLS[@]}"
    log_ok "Tools installed."
  fi
fi

# ── 2. Secure Dynamic Env Generator ─────────────────────────────
ENV_FILE="$ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  log_info "Creating new .env file..."
  touch "$ENV_FILE"
fi

# Helper to read masked secret and update env file if key is empty
update_env_var() {
  local key="$1"
  local prompt="$2"
  local validate_regex="${3:-}"  # optional
  local existing
  existing=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2- || true)
  if [ -n "$existing" ]; then
    # If value is just empty string but key exists, still prompt to fill
    return
  fi

  while true; do
    echo -n "${prompt}: "
    read -s value
    echo ""
    if [ -z "$value" ]; then
      log_warn "Value cannot be empty."
      continue
    fi
    if [ -n "$validate_regex" ]; then
      if [[ "$value" =~ $validate_regex ]]; then
        break
      else
        log_warn "Invalid format. Expected format: $validate_regex"
      fi
    else
      break
    fi
  done
  # Remove any existing line and append
  sed -i "/^${key}=/d" "$ENV_FILE"
  echo "${key}=${value}" >> "$ENV_FILE"
  log_ok "${key} saved."
}

# Basic validation for Supabase URL
SUPABASE_URL_REGEX='^https://[a-z0-9]+\.supabase\.co$'

log_info "Verifying environment variables..."
update_env_var "SUPABASE_URL"              "Supabase URL (https://xxx.supabase.co)"   "$SUPABASE_URL_REGEX"
update_env_var "SUPABASE_ANON_KEY"         "Supabase Anon Key"
update_env_var "SUPABASE_SERVICE_ROLE_KEY"  "Supabase Service Role Key (HIGH PRIVILEGE)"  ""
update_env_var "ANTHROPIC_API_KEY"         "Anthropic API Key (Claude Fable 5)"
update_env_var "OPENAI_API_KEY"            "OpenAI API Key (GPT-5.6 Sol)"
update_env_var "DEEPSEEK_API_KEY"          "DeepSeek API Key (DeepSeek V4 Pro)"
update_env_var "GEMINI_API_KEY"            "Gemini API Key (Gemini 3.5 Pro)"

log_ok "All required keys present in .env."

# ── 3. Automated Package Audit ─────────────────────────────────
log_info "Checking Node.js dependencies..."
if [ ! -d node_modules ]; then
  log_warn "node_modules not found. Installing dependencies..."
  npm install
else
  # Check if ws, @supabase/supabase-js, dotenv are present; if not, install
  if ! node -e "require('ws')" 2>/dev/null || \
     ! node -e "require('@supabase/supabase-js')" 2>/dev/null || \
     ! node -e "require('dotenv')" 2>/dev/null; then
    log_warn "Some dependencies are missing. Running npm install..."
    npm install
  else
    log_ok "All critical dependencies are installed."
  fi
fi

# ── 4. Self-Healing Kernel Launcher ────────────────────────────
launch_menu() {
  echo ""
  echo -e "${C_BLUE}╔══════════════════════════════════════╗${C_RESET}"
  echo -e "${C_BLUE}║   KLYN AI OS LAUNCH OPTIONS         ║${C_RESET}"
  echo -e "${C_BLUE}╚══════════════════════════════════════╝${C_RESET}"
  echo ""
  echo "  [1] Run Klyn AI OS in Standard Mode       (node index.js)"
  echo "  [2] Run with Self-Healing Kernel          (node --expose-gc kernel/orchestrator.js)"
  echo "  [3] Run Offline-First Mode                (AI_PROVIDER=ollama node index.js)"
  echo "  [4] Exit"
  echo ""
  read -r -p "Select an option [1-4]: " CHOICE

  case $CHOICE in
    1) log_info "Launching Standard Mode..."
       node index.js
       ;;
    2) log_info "Launching Self-Healing Kernel..."
       if [ ! -f kernel/orchestrator.js ]; then
         log_err "kernel/orchestrator.js not found. Cannot launch self-healing kernel."
         exit 1
       fi
       node --expose-gc kernel/orchestrator.js
       ;;
    3) log_info "Launching Offline-First Mode (Ollama)..."
       AI_PROVIDER=ollama node index.js
       ;;
    4) log_info "Exiting."
       exit 0
       ;;
    *) log_err "Invalid selection."
       launch_menu
       ;;
  esac
}

# Source the .env so the launched process inherits values
set -a
source "$ENV_FILE"
set +a

launch_menu
