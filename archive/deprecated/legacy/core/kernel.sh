#!/usr/bin/env bash
set -euo pipefail

JOBS="runtime/jobs.jsonl"
TMP="runtime/jobs.tmp"

mkdir -p runtime
touch "$JOBS"
: > "$TMP"

echo "[KERNEL] 🧠 Autonomous scheduler active"

priority() {
  case "$1" in
    planner) echo 1 ;;
    coder) echo 2 ;;
    reviewer) echo 3 ;;
    executor) echo 4 ;;
    *) echo 5 ;;
  esac
}

SORTED="runtime/sorted.tmp"
FINAL="runtime/sorted_final.tmp"

: > "$SORTED"

while IFS= read -r line; do
  [ -z "$line" ] && continue

  STATUS=$(echo "$line" | cut -d'|' -f1)
  AGENT=$(echo "$line" | cut -d'|' -f2)
  TASK=$(echo "$line" | cut -d'|' -f3-)

  if [ "$STATUS" = "DONE" ]; then
    echo "$line" >> "$TMP"
    continue
  fi

  P=$(priority "$AGENT")
  echo "$P|$AGENT|$TASK" >> "$SORTED"

done < "$JOBS"

if [ -s "$SORTED" ]; then
  sort -n "$SORTED" > "$FINAL"

  while IFS= read -r line; do
    AGENT=$(echo "$line" | cut -d'|' -f2)
    TASK=$(echo "$line" | cut -d'|' -f3-)

    echo "[KERNEL] ⚙ Executing $AGENT → $TASK"

    if [ -f "agents/${AGENT}.sh" ]; then
      bash "agents/${AGENT}.sh" "$TASK"
      echo "DONE|$AGENT|$TASK" >> "$TMP"
    else
      echo "[KERNEL] ERROR: missing agent $AGENT"
    fi
  done < "$FINAL"
fi

mv "$TMP" "$JOBS"
rm -f "$SORTED" "$FINAL"

echo "[KERNEL] ✅ Cycle completed"
