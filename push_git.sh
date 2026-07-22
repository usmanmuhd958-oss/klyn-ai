#!/usr/bin/env bash

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo -e "${PURPLE}====================================================${NC}"
echo -e "${CYAN}🚀 KLYN AI OS - ENTERPRISE GIT DEPLOYMENT ENGINE${NC}"
echo -e "${PURPLE}====================================================${NC}\n"

# 1. Check if inside Git Repository
if [ ! -d ".git" ]; then
  log_error "Not a Git repository. Run 'git init' first."
fi

# 2. Security Check (.gitignore & .env safety)
if [ -f ".env" ]; then
  if ! grep -q "^\.env$" .gitignore 2>/dev/null; then
    log_warn "Security Alert: '.env' was missing from .gitignore. Adding it now..."
    echo -e "\n.env\n*.env\nnode_modules/\ndist/" >> .gitignore
    log_success "Protected '.env' from cloud deployment!"
  fi
fi

# 3. Clean temporary files
log_info "Cleaning temporary build and swap files..."
find . -type f \( -name "*.save" -o -name "*.backup-*" -o -name "*.orig" -o -name "*.log" \) -delete 2>/dev/null || true

# 4. Check Git Status
if [ -z "$(git status --porcelain)" ]; then
  log_warn "Working directory clean. Nothing to commit or push."
  exit 0
fi

# 5. Stage Changes
log_info "Staging changed files..."
git add .

# 6. Commit Message Handling
DEFAULT_MSG="feat(core): update KLYN AI OS architecture & components"
if [ -n "$1" ]; then
  COMMIT_MSG="$1"
else
  echo -e "\n${YELLOW}Enter Commit Message (or press ENTER for default):${NC}"
  read -r INPUT_MSG
  COMMIT_MSG="${INPUT_MSG:-$DEFAULT_MSG}"
fi

log_info "Creating git commit..."
git commit -m "$COMMIT_MSG"

# 7. Check Remote URL
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
HAS_REMOTE=$(git remote 2>/dev/null || true)

if [ -z "$HAS_REMOTE" ]; then
  log_warn "No remote origin configured!"
  echo -e "${YELLOW}Enter your GitHub/GitLab Repository URL:${NC}"
  read -r REPO_URL
  if [ -n "$REPO_URL" ]; then
    git remote add origin "$REPO_URL"
    log_success "Added remote origin URL!"
  else
    log_error "No repository URL provided. Aborting deployment!"
  fi
fi

# 8. Push Code to Remote
log_info "Pushing code to remote branch [${CURRENT_BRANCH}]..."
if git push -u origin "$CURRENT_BRANCH"; then
  echo -e "\n${PURPLE}====================================================${NC}"
  log_success "KLYN AI OS DEPLOYED TO CLOUD SUCCESSFULLY! 🚀"
  echo -e "${PURPLE}====================================================${NC}"
else
  log_error "Push failed. Check your network or Personal Access Token (PAT)."
fi
