#!/usr/bin/env bash
set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===================================================================${NC}"
echo -e "${BLUE}           KLYN AI OS - INTEGRITY & DIAGNOSTIC HEALTH CHECK        ${NC}"
echo -e "${BLUE}===================================================================${NC}"

readonly KLYN_ROOT="${KLYN_ROOT:-${HOME}/klyn-ai-os}"
ERRORS=0

check_file() {
    local file="$1"
    local check_exec="${2:-false}"
    
    if [ -f "$file" ]; then
        if [ "$check_exec" = "true" ]; then
            if [ -x "$file" ]; then
                echo -e "[ ${GREEN}OK${NC} ] Executable: ${file#$KLYN_ROOT/}"
            else
                echo -e "[ ${YELLOW}WARN${NC} ] Missing executable bit: ${file#$KLYN_ROOT/} (fixing now...)"
                chmod +x "$file"
                ERRORS=$((ERRORS + 1))
            fi
        else
            echo -e "[ ${GREEN}OK${NC} ] File Exists: ${file#$KLYN_ROOT/}"
        fi
    else
        echo -e "[ ${RED}FAIL${NC} ] Missing critical file: ${file#$KLYN_ROOT/}"
        ERRORS=$((ERRORS + 1))
    fi
}

echo -e "\n${BLUE}--- Phase 1: Checking Critical Executable Bash Scripts ---${NC}"
check_file "$KLYN_ROOT/agents/src/orchestrator.sh" "true"
check_file "$KLYN_ROOT/scripts/bootstrap.sh" "true"
check_file "$KLYN_ROOT/scripts/doctor.sh" "true"
check_file "$KLYN_ROOT/scripts/health_check.js" "false"

echo -e "\n${BLUE}--- Phase 2: Checking New Kernel Orchestrator Files ---${NC}"
check_file "$KLYN_ROOT/kernel/orchestrator.js" "false"
check_file "$KLYN_ROOT/kernel/src/execution/agent_executor.js" "false"
check_file "$KLYN_ROOT/kernel/src/execution/hot_swap_manager.js" "false"
check_file "$KLYN_ROOT/kernel/src/execution/git_health_manager.js" "false"

echo -e "\n${BLUE}--- Phase 3: Checking Node.js Module Syntax Integrity ---${NC}"
if command -v node >/dev/null 2>&1; then
    # Test loading newly deployed JS files to ensure no syntax errors
    for js_file in "$KLYN_ROOT/kernel/orchestrator.js" \
                   "$KLYN_ROOT/kernel/src/execution/agent_executor.js" \
                   "$KLYN_ROOT/kernel/src/execution/hot_swap_manager.js" \
                   "$KLYN_ROOT/kernel/src/execution/git_health_manager.js"; do
        if [ -f "$js_file" ]; then
            if node -c "$js_file" >/dev/null 2>&1; then
                echo -e "[ ${GREEN}OK${NC} ] Node Syntax Clean: ${js_file#$KLYN_ROOT/}"
            else
                echo -e "[ ${RED}FAIL${NC} ] Syntax/Parsing Error in: ${js_file#$KLYN_ROOT/}"
                node -c "$js_file" || true
                ERRORS=$((ERRORS + 1))
            fi
        fi
    done
else
    echo -e "[ ${YELLOW}WARN${NC} ] Node.js executable not found in PATH. Skipping syntax parsing tests."
fi

echo -e "\n${BLUE}--- Phase 4: Runtime Environment Verification ---${NC}"
readonly RUNTIME_DIR="$KLYN_ROOT/.runtime"
mkdir -p "$RUNTIME_DIR/pids" "$RUNTIME_DIR/logs" "$RUNTIME_DIR/sockets" "$RUNTIME_DIR/swap"

if [ -d "$RUNTIME_DIR" ] && [ -w "$RUNTIME_DIR" ]; then
    echo -e "[ ${GREEN}OK${NC} ] Runtime engine partition is mounted & writeable."
else
    echo -e "[ ${RED}FAIL${NC} ] Runtime partition is missing or read-only."
    ERRORS=$((ERRORS + 1))
fi

echo -e "\n${BLUE}===================================================================${NC}"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}SUCCESS: All verified files, scripts, and permissions are perfectly aligned!${NC}"
else
    echo -e "${YELLOW}WARNING: Diagnostic completed with $ERRORS alignment adjustment(s).${NC}"
fi
echo -e "${BLUE}===================================================================${NC}"
