#!/usr/bin/env bash

set -e

echo "=========================================================="
echo "  KLYN AI OS - Step-by-Step Fixed Architecture Loader"
echo "=========================================================="

# Ensure directories exist
mkdir -p src/core src/ai

FILES=(
  "src/core/kernel.ts"
  "src/core/vfs.ts"
  "src/core/process-manager.ts"
  "src/ai/context-engine.ts"
)

TOTAL_FILES=${#FILES[@]}

for i in "${!FILES[@]}"; do
  STEP=$((i + 1))
  FILE="${FILES[$i]}"

  echo ""
  echo "----------------------------------------------------------"
  echo "  [$STEP/$TOTAL_FILES] Target File: $FILE"
  echo "----------------------------------------------------------"
  echo "Instructions:"
  echo " 1. Copy the fixed Sonnet code for '$FILE'."
  echo " 2. Press [ENTER] below to open nano."
  echo " 3. Clear existing contents (Ctrl+K) or overwrite, then paste."
  echo " 4. Save & Exit: Press Ctrl+O -> Enter -> Ctrl+X"
  echo "----------------------------------------------------------"

  read -r -p "Press [ENTER] to launch nano for $FILE..."

  nano "$FILE"

  if [ -s "$FILE" ]; then
    echo "[SUCCESS] $FILE updated successfully."
  else
    echo "[WARNING] $FILE is empty or was not saved."
  fi
done

echo ""
echo "=========================================================="
echo "  [VERIFYING] Running TypeScript Compiler Check..."
echo "=========================================================="
echo ""

npx tsc --noEmit

echo ""
echo "=========================================================="
echo "  [COMPLETE] Compilation clean! Staging to Git..."
echo "=========================================================="
git add src/core/ src/ai/
git status --short

echo ""
echo "Execution finished. Ready for commit & push."
