#!/data/data/com.termux/files/usr/bin/bash

mkdir -p runtime

TASK="$1"

echo "[PLANNER] $TASK"

echo "$TASK" >> runtime/state.db
