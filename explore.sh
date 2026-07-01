#!/bin/bash
set -euo pipefail

WORKSPACE_ROOT="runtime/workspace"

mkdir -p "$WORKSPACE_ROOT"

# -----------------------------
# PICK PIPELINE ID
# -----------------------------
PIPELINE_ID="${1:-}"

if [[ -z "$PIPELINE_ID" ]]; then
  PIPELINE_ID=$(ls -t "$WORKSPACE_ROOT" 2>/dev/null | head -n 1 || true)
fi

TARGET_DIR="$WORKSPACE_ROOT/$PIPELINE_ID"

# -----------------------------
# FAIL SAFE CHECK
# -----------------------------
if [[ -z "$PIPELINE_ID" || ! -d "$TARGET_DIR" ]]; then
  echo "======================================"
  echo " KLYN AI OS v6 - WORKSPACE EXPLORER"
  echo "======================================"
  echo ""
  echo "No active workspaces found."
  echo "Please run a pipeline first."
  echo ""
  exit 0
fi

clear

# -----------------------------
# HEADER
# -----------------------------
echo "======================================"
echo " KLYN AI OS v6 - WORKSPACE VIEWER"
echo "======================================"
echo ""
echo "PIPELINE ID: $PIPELINE_ID"
echo "LOCATION   : $TARGET_DIR"
echo ""
echo "======================================"
echo ""

# -----------------------------
# FILE LIST
# -----------------------------
FILES=("plan.txt" "code.txt" "review.txt" "manifest.txt")

found_any=0

for file in "${FILES[@]}"; do
  FILE_PATH="$TARGET_DIR/$file"

  if [[ -f "$FILE_PATH" ]]; then
    found_any=1

    echo "--------------------------------------"
    echo "[ FILE: $file ]"
    echo "--------------------------------------"
    echo ""

    cat "$FILE_PATH"

    echo ""
    echo ""
  fi
done

# -----------------------------
# EMPTY WORKSPACE HANDLING
# -----------------------------
if [[ "$found_any" -eq 0 ]]; then
  echo "[EMPTY] Workspace exists but contains no artifacts yet."
  echo "Pipeline may still be running..."
  echo ""
fi

echo "======================================"
echo " END OF WORKSPACE"
echo "======================================"
