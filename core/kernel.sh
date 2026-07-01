#!/data/data/com.termux/files/usr/bin/bash

JOBS="runtime/jobs.db"
TMP="runtime/queue.tmp"

[ ! -f "$JOBS" ] && touch "$JOBS"
> "$TMP"

echo "[KERNEL] 🧠 Autonomous scheduler active"

# PRIORITY SYSTEM:
# planner = 1 (highest)
# coder = 2
# reviewer = 3
# executor = 4

priority() {
    case "$1" in
        planner) echo 1 ;;
        coder) echo 2 ;;
        reviewer) echo 3 ;;
        executor) echo 4 ;;
        *) echo 5 ;;
    esac
}

# LOAD ALL JOBS INTO MEMORY
while IFS= read -r line; do

    [ -z "$line" ] && continue

    STATUS=$(echo "$line" | cut -d'|' -f1)
    AGENT=$(echo "$line" | cut -d'|' -f2)
    TASK=$(echo "$line" | cut -d'|' -f3)

    if [ "$STATUS" = "DONE" ]; then
        echo "$line" >> "$TMP"
        continue
    fi

    # AUTONOMOUS DECISION ENGINE
    P=$(priority "$AGENT")

    echo "$P|$AGENT|$TASK" >> runtime/sorted.tmp

done < "$JOBS"

# SORT BY PRIORITY (AI DECISION LAYER)
sort runtime/sorted.tmp > runtime/sorted_final.tmp

# EXECUTE INTELLIGENTLY
while IFS= read -r line; do

    AGENT=$(echo "$line" | cut -d'|' -f2)
    TASK=$(echo "$line" | cut -d'|' -f3)

    echo "[KERNEL] ⚙ Executing $AGENT → $TASK"

    if [ -f "agents/${AGENT}.sh" ]; then
        bash agents/${AGENT}.sh "$TASK"
    else
        echo "[KERNEL] ERROR: missing agent $AGENT"
    fi

    echo "DONE|$AGENT|$TASK" >> "$TMP"

done < runtime/sorted_final.tmp

mv "$TMP" "$JOBS"
rm -f runtime/sorted.tmp runtime/sorted_final.tmp
