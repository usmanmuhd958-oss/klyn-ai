#!/usr/bin/env bash

# Klyn AI OS - Nano Editor Script for Query Engine & Package JSON
set -e

PROJECT_DIR="$HOME/klyn-ai-os"

if [ -d "$PROJECT_DIR" ]; then
  cd "$PROJECT_DIR"
else
  mkdir -p "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

FILES=(
  "package.json"
  "src/query/query_engine.ts"
)

TOTAL=${#FILES[@]}
CURRENT=1

echo "=========================================================="
echo "       KLYN AI OS — NANO SEQUENCE (QUERY & PACKAGE)      "
echo "=========================================================="
echo ""

for FILE in "${FILES[@]}"; do
  DIR=$(dirname "$FILE")
  mkdir -p "$DIR"
  touch "$FILE"

  echo "----------------------------------------------------------"
  echo " File [$CURRENT/$TOTAL]: $FILE"
  echo "----------------------------------------------------------"
  read -p "Press [ENTER] to open in nano (or Ctrl+C to abort)... " dummy

  nano "$FILE"

  echo "[DONE] Saved: $FILE"
  echo ""
  CURRENT=$((CURRENT + 1))
done

echo "=========================================================="
echo "                FILES UPDATED SUCCESSFULLY!               "
echo "=========================================================="
