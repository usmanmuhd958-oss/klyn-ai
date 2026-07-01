#!/data/data/com.termux/files/usr/bin/bash

bash cluster/init.sh

NODES="runtime/nodes.jsonl"
JOBS="runtime/jobs.jsonl"
LOG="runtime/system.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [MASTER] [$1] $2" >> "$LOG"
}

choose_node() {
    # SAFETY CHECK FIRST
    if [ ! -s "$NODES" ]; then
        log "WARN" "No nodes registered yet"
        return
    fi

    NODE=$(grep "ALIVE" "$NODES" | cut -d'|' -f1 | shuf | head -n 1)
    echo "$NODE"
}

assign_jobs() {
    TMP="runtime/tmp.$$"
    > "$TMP"

    while IFS= read -r line; do
        [ -z "$line" ] && continue

        STATUS=$(echo "$line" | cut -d'|' -f1)
        AGENT=$(echo "$line" | cut -d'|' -f2)
        TASK=$(echo "$line" | cut -d'|' -f3)
        JOBID=$(echo "$line" | cut -d'|' -f4)

        if [ "$STATUS" = "QUEUED" ]; then

            NODE=$(choose_node)

            if [ -n "$NODE" ]; then
                echo "$STATUS|$AGENT|$TASK|$JOBID|$NODE" >> "$TMP"
                log "ASSIGN" "Job $JOBID → Node $NODE"
            else
                echo "$line" >> "$TMP"
                log "WAIT" "No active nodes"
            fi

        else
            echo "$line" >> "$TMP"
        fi

    done < "$JOBS"

    mv "$TMP" "$JOBS"
}

assign_jobs
