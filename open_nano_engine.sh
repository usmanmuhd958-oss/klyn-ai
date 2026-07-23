#!/usr/bin/env bash

# ==============================================================================
# KLYN AI OS - Sequential Nano Workspace Initializer
# Target: Manual Code Injection Pipeline for Engine Modules
# ==============================================================================

set -euo pipefail

# ANSI Terminal Styling
readonly BLUE='\033[0;34m'
readonly GREEN='\033[0;32m'
readonly CYAN='\033[0;36m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly BOLD='\033[1m'
readonly NC='\033[0m'

# Core Target Modules
readonly TARGET_FILES=(
    "kernel/src/indexer/merkle_dag.ts"
    "kernel/src/indexer/ast_graph.ts"
    "kernel/src/indexer/hybrid_search.ts"
    "kernel/src/indexer/context_weaver.ts"
    "kernel/src/indexer/index.ts"
    "example/usage.ts"
)

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

verify_environment() {
    if ! command -v nano &> /dev/null; then
        log_error "Text editor 'nano' is missing. Install using: pkg install nano"
        exit 1
    fi
}

initialize_structure() {
    log_info "Initializing directory architecture..."
    mkdir -p kernel/src/indexer example
}

launch_nano_sequence() {
    local total=${#TARGET_FILES[@]}
    local index=1

    for file in "${TARGET_FILES[@]}"; do
        touch "$file"
        
        clear
        echo -e "${BOLD}${CYAN}==========================================================${NC}"
        echo -e "${BOLD}${CYAN}  Step ${index}/${total}: Editing ${file}${NC}"
        echo -e "${BOLD}${CYAN}==========================================================${NC}"
        log_info "Launching nano editor for target file..."
        echo -e "${YELLOW}Instructions: Paste your code -> Press Ctrl+O -> Press Enter -> Press Ctrl+X${NC}\n"
        
        sleep 1.5
        nano "$file"

        log_success "Completed: ${file}"
        ((index++))
    done
}

main() {
    verify_environment
    initialize_structure
    launch_nano_sequence

    clear
    echo -e "${BOLD}${GREEN}==========================================================${NC}"
    echo -e "${BOLD}${GREEN}  Workspace Deployment Complete. All 6 files updated.    ${NC}"
    echo -e "${BOLD}${GREEN}==========================================================${NC}"
}

main "$@"
