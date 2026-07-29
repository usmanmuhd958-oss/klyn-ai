#!/usr/bin/env bash

set -e

echo "=========================================================="
echo "  KLYN AI OS - Step-by-Step Interactive File Setup Routine"
echo "=========================================================="

# 1. Ensure required directory structure exists
echo "[INFO] Creating project directory layout..."
mkdir -p src/core src/ai

# List of target architecture files
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
  echo " 1. Copy the Sonnet code for '$FILE'."
  echo " 2. Press [ENTER] below to open nano."
  echo " 3. Paste the code into the editor."
  echo " 4. Save & Exit: Press Ctrl+O -> Enter -> Ctrl+X"
  echo "----------------------------------------------------------"
  
  read -r -p "Press [ENTER] to launch nano for $FILE..."

  # Open nano editor for the target file
  nano "$FILE"

  if [ -s "$FILE" ]; then
    echo "[SUCCESS] File $FILE saved successfully."
  else
    echo "[WARNING] $FILE is empty or was not saved."
  fi
done

echo ""
echo "=========================================================="
echo "  [COMPLETE] All core architectural files configured!"
echo "=========================================================="
echo "Staging files to Git index..."
git add src/core/ src/ai/

echo ""
echo "[INFO] Git Repository Status:"
git status --short

echo ""
echo "Execution finished. Ready for commit & push."
