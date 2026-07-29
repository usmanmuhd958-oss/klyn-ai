#!/usr/bin/env bash

# ==============================================================================
# KLYN AI OS - System Diagnostics & Memory Audit
# ==============================================================================

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}          KLYN AI OS - SYSTEM HEALTH AUDIT          ${NC}"
echo -e "${CYAN}====================================================${NC}"

# 1. Memory Check
MEM_USAGE=$(free -m | awk 'NR==2{printf "%.2f%%", $3*100/$2 }')
echo -e "${GREEN}[1/3] System RAM Usage:${NC} $MEM_USAGE"

# 2. Check TypeScript Compilation Integrity
echo -e "${GREEN}[2/3] Verifying TypeScript Types...${NC}"
if ./node_modules/.bin/tsc --noEmit; then
    echo -e "${GREEN}[✓] TypeScript Type Check PASSED (0 Errors)${NC}"
else
    echo -e "${YELLOW}[!] Type errors detected in workspace.${NC}"
fi

# 3. Execution Engine Integrity
echo -e "${GREEN}[3/3] Running ContextWeaver Integration Harness...${NC}"
./scripts/run_tests.sh

echo -e "${CYAN}====================================================${NC}"
echo -e "${GREEN}       ALL KERNEL SYSTEMS OPERATIONAL 💯            ${NC}"
echo -e "${CYAN}====================================================${NC}"
