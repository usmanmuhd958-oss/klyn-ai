#!/data/data/com.termux/files/usr/bin/bash

ID=$1
JOBS="runtime/jobs.jsonl"
LOCKDIR="runtime/locks"
LOG="runtime/system.log"

mkdir -p "$LOCKDIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WORKER-$ID] [$1] $2" >> "$LOG"
}

claim_job() {
    TMP="runtime/tmp.$$"

    while true; do
        FOUND=0
        > "$TMP"

        while IFS= read -r line; do
            [ -z "$line" ] && continue

            STATUS=$(echo "$line" | cut -d'|' -f1)
            AGENT=$(echo "$line" | cut -d'|' -f2)
            TASK=$(echo "$line" | cut -d'|' -f3)
            JOBID=$(echo "$line" | cut -d'|' -f4)

            if [ "$STATUS" = "QUEUED" ] && [ ! -f "$LOCKDIR/$JOBID.lock" ]; then

                touch "$LOCKDIR/$JOBID.lock"

                log "CLAIM" "Job $JOBID claimed → $AGENT"

                # Execute agent
                if [ -f "agents/${AGENT}.sh" ]; then
                    bash "agents/${AGENT}.sh" "$TASK" >/dev/null 2>&1
                    log "DONE" "$AGENT completed $TASK"
                else
                    log "ERROR" "Missing agent $AGENT"
                fi

                echo "DONE|$AGENT|$TASK|$JOBID" >> "$TMP"
                FOUND=1
            else
                echo "$line" >> "$TMP"
            fi

        done < "$JOBS"

        mv "$TMP" "$JOBS"

        # Idle sleep
        sleep 1
    done
}

claim_job
