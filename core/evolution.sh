#!/data/data/com.termux/files/usr/bin/bash

echo "[EVOLUTION] 🧠 Running self-improvement cycle..."

METRICS="runtime/metrics.db"
CONF="runtime/evolution.conf"

mkdir -p runtime
[ ! -f "$METRICS" ] && touch "$METRICS"
[ ! -f "$CONF" ] && echo "planner=1 coder=2 reviewer=3 executor=4" > "$CONF"

# ==============================
# 1. COLLECT PERFORMANCE DATA
# ==============================
# count job completions per agent
PLANNER=$(grep "DONE|planner" runtime/jobs.db | wc -l)
CODER=$(grep "DONE|coder" runtime/jobs.db | wc -l)
REVIEWER=$(grep "DONE|reviewer" runtime/jobs.db | wc -l)
EXECUTOR=$(grep "DONE|executor" runtime/jobs.db | wc -l)

echo "planner:$PLANNER coder:$CODER reviewer:$REVIEWER executor:$EXECUTOR" > "$METRICS"

# ==============================
# 2. SIMPLE ADAPTIVE RULE ENGINE
# ==============================
# more success = lower priority number (faster execution)

update_priority() {

    AGENT=$1
    VALUE=$2

    if [ "$VALUE" -gt 10 ]; then
        P=1
    elif [ "$VALUE" -gt 5 ]; then
        P=2
    else
        P=3
    fi

    sed -i "s/${AGENT}=./${AGENT}=$P/" "$CONF"
}

update_priority "planner" "$PLANNER"
update_priority "coder" "$CODER"
update_priority "reviewer" "$REVIEWER"
update_priority "executor" "$EXECUTOR"

echo "[EVOLUTION] ✅ Kernel parameters updated"
