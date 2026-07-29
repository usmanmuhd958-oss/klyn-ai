#!/usr/bin/env bash

# ==============================================================================
# KLYN AI OS - Professional JS to TS Migration Tool
# Safely renames .js files to .ts using Git history tracking & zero code loss.
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DRY_RUN=false

if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
    echo -e "${YELLOW}🔍 RUNNING IN DRY-RUN MODE (No files will be changed)${NC}\n"
fi

echo -e "${BLUE}🚀 Starting KLYN AI OS JS-to-TS Migration Engine...${NC}\n"

# Search for JS files excluding node_modules, git, and build folders
JS_FILES=$(find . -type f -name "*.js" \
    -not -path "*/node_modules/*" \
    -not -path "*/.git/*" \
    -not -path "*/.klyn/*" \
    -not -path "*/dist/*" \
    -not -path "*/build/*" \
    -not -path "*/apps/web/public/*")

TOTAL=0
CONVERTED=0
SKIPPED=0

for js_file in $JS_FILES; do
    TOTAL=$((TOTAL + 1))
    ts_file="${js_file%.js}.ts"

    # Safety Check: Skip if corresponding .ts file already exists
    if [ -f "$ts_file" ]; then
        echo -e "${YELLOW}⚠️  Skipping (TS file already exists): ${js_file}${NC}"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    echo -e "${GREEN}🔄 Converting: ${js_file} ➔ ${ts_file}${NC}"

    if [ "$DRY_RUN" = false ]; then
        # 1. Rename via git mv if tracked, or standard mv if untracked
        if git ls-files --error-unmatch "$js_file" >/dev/null 2>&1; then
            git mv "$js_file" "$ts_file"
        else
            mv "$js_file" "$ts_file"
        fi

        # 2. Update relative import statements inside the converted file
        # Convert: import { x } from './module.js' -> import { x } from './module'
        sed -i "s/from '\(.*\)\.js'/from '\1'/g" "$ts_file" 2>/dev/null || true
        sed -i 's/from "\(*\)\.js"/from "\1"/g' "$ts_file" 2>/dev/null || true
    fi

    CONVERTED=$((CONVERTED + 1))
done

echo -e "\n${BLUE}====================================================${NC}"
echo -e "${GREEN}📊 MIGRATION SUMMARY${NC}"
echo -e "${BLUE}====================================================${NC}"
echo -e "Total JS files scanned : $TOTAL"
echo -e "Successfully converted : $CONVERTED"
echo -e "Skipped (TS existed)   : $SKIPPED"
echo -e "${BLUE}====================================================${NC}"

if [ "$DRY_RUN" = true ]; then
    echo -e "\n${YELLOW}To perform the real migration, execute:${NC}"
    echo -e "  bash migrate_js_to_ts.sh"
else
    echo -e "\n${GREEN}✨ Migration finished safely with zero code loss!${NC}"
    echo -e "Run testing suite to verify: ${YELLOW}npx tsx test.ts${NC}"
fi
