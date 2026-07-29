#!/usr/bin/env bash

# ==============================================================================
# KLYN AI OS - Environment & Dependency Stabilizer
# Target: Termux / ARM64 / Node.js Runtime
# ==============================================================================

set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}[KLYN-AI-OS] Starting Enterprise Environment Setup...${NC}"

# 1. Optimize NPM Network & Mirror for Termux
echo -e "${GREEN}[+] Configuring NPM Mirror & Offline Cache Baseline...${NC}"
npm config set registry https://registry.npmmirror.com
npm config set fetch-retries 5
npm config set fetch-retry-mintimeout 20000
npm config set fetch-retry-maxtimeout 120000

# 2. Ensure Core Dev Tools are Installed Locally
echo -e "${GREEN}[+] Installing Core Toolchain (Vitest, TSX, TypeScript)...${NC}"
npm install --save-dev vitest tsx typescript @types/node

# 3. Create Binary Symlinks Directory for Zero-NPX Operations
echo -e "${GREEN}[+] Verifying node_modules/.bin integrity...${NC}"
if [ -d "./node_modules/.bin" ]; then
    echo -e "${GREEN}[✓] Local binary runner available at ./node_modules/.bin${NC}"
else
    echo -e "${RED}[!] Critical: Local binaries failed to build.${NC}"
    exit 1
fi

echo -e "${CYAN}[KLYN-AI-OS] Setup Completed Successfully! 🚀${NC}"
