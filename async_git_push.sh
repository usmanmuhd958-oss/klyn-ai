#!/usr/bin/env bash

# ==============================================================================
# KLYN AI OS - Asynchronous Multi-Remote Git Push Utility (Termux Native)
# Dispatches parallel, non-blocking push tasks to GitHub, GitLab, and origin
# ==============================================================================

set -euo pipefail

# ANSI Color Codes
readonly BLUE='\033[0;34m'
readonly GREEN='\033[0;32m'
readonly CYAN='\033[0;36m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly BOLD='\033[1m'
readonly NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Resolve Termux compatible temp directory
TEMP_BASE="${TMPDIR:-/tmp}"
mkdir -p "$TEMP_BASE"

WORK_DIR=$(mktemp -d "${TEMP_BASE}/klyn_async_push_XXXXXX")
PID_FILE="${WORK_DIR}/pids.txt"
touch "$PID_FILE"

cleanup() {
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

get_active_branch() {
    git branch --show-current 2>/dev/null || echo "main"
}

dispatch_async_push() {
    local remote="$1"
    local branch="$2"
    local log_file="${WORK_DIR}/git_push_${remote}.log"

    log_info "Dispatching async push task for remote '${BOLD}${remote}${NC}' on branch '${BOLD}${branch}${NC}'..."

    (
        if git push "$remote" "$branch" > "$log_file" 2>&1; then
            echo -e "${GREEN}[ASYNC OK] Push to '${remote}' (${branch}) completed successfully.${NC}" >> "$log_file"
        else
            echo -e "${RED}[ASYNC FAIL] Push to '${remote}' (${branch}) failed. Details below:${NC}" >> "$log_file"
        fi
    ) &

    local pid=$!
    echo "$pid:$remote:$log_file" >> "$PID_FILE"
    log_success "Task spawned for remote '${remote}' [PID: ${pid}]"
}

await_completion() {
    if [[ ! -s "$PID_FILE" ]]; then
        log_warn "No active background tasks detected."
        return
    fi

    log_info "Awaiting background task synchronization..."
    echo -e "${CYAN}----------------------------------------------------------${NC}"

    while IFS=':' read -r pid remote log_file; do
        wait "$pid" || true
        if [[ -f "$log_file" ]]; then
            cat "$log_file"
        fi
    done < "$PID_FILE"

    echo -e "${CYAN}----------------------------------------------------------${NC}"
    log_success "All asynchronous push routines completed."
}

main() {
    echo -e "${BOLD}${CYAN}==========================================================${NC}"
    echo -e "${BOLD}${CYAN}  KLYN AI OS - Asynchronous Git Push Pipeline            ${NC}"
    echo -e "${BOLD}${CYAN}==========================================================${NC}"

    local remotes
    remotes=$(git remote)

    if [[ -z "$remotes" ]]; then
        log_error "No Git remotes configured. Register a remote using: git remote add origin <URL>"
        exit 1
    fi

    local current_branch
    current_branch=$(get_active_branch)

    log_info "Detected branch: ${BOLD}${current_branch}${NC}"
    log_info "Configured remotes: $(echo $remotes | tr '\n' ' ')"
    echo ""

    for remote in $remotes; do
        dispatch_async_push "$remote" "$current_branch"
    done

    echo ""
    await_completion
}

main "$@"
