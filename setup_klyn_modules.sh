#!/usr/bin/env bash

# ==========================================================
#  KLYN AI OS - Interactive Module Creator & Nano Launcher
# ==========================================================

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}[INFO] Creating required directory hierarchy...${NC}"
mkdir -p kernel/src/dag kernel/src/orchestrator kernel/src/ast

# List of target files for Sonnet code
FILES=(
  "kernel/src/dag/merkle_engine.ts"
  "kernel/src/orchestrator/swarm_benchmark.ts"
  "kernel/src/orchestrator/dag_swarm_bridge.ts"
  "kernel/src/ast/context_graph.ts"
  "kernel/src/kernel_master.ts"
)

echo -e "${GREEN}[SUCCESS] Directories ready! Starting module setup workflow...${NC}\n"

for FILE in "${FILES[@]}"; do
  echo -e "${YELLOW}----------------------------------------------------------${NC}"
  echo -e "Target File: ${GREEN}$FILE${NC}"
  echo -e "${YELLOW}----------------------------------------------------------${NC}"
  read -p "Danna ENTER domin buɗe fayil ɗin a Nano da manna code..."
  
  # Ensure target file's specific directory exists before launching nano
  mkdir -p "$(dirname "$FILE")"
  
  # Open Nano
  nano "$FILE"
  
  echo -e "${GREEN}[✔] Completed:${NC} $FILE\n"
done

echo -e "${BLUE}[INFO] Running TypeScript Type-Checker (npx tsc --noEmit)...${NC}"
npx tsc --noEmit

if [ $? -eq 0 ]; then
  echo -e "${GREEN}[SUCCESS] All modules passed TypeScript verification with 0 errors! 🚀${NC}"
else
  echo -e "${YELLOW}[WARNING] Found TypeScript errors. Check the logs above.${NC}"
fi
