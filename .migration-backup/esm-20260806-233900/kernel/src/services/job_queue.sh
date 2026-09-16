#!/bin/bash
JOB_DIR="${PROJECT_ROOT:-..}/runtime/queue"
MAX_RETRIES=3

enqueue() {
    mkdir -p "$JOB_DIR"
    local id=$(uuidgen)
    echo '{"id":"'"$id"'","task":"'"$*"'","retries":0,"status":"pending"}' > "$JOB_DIR/$id.json"
    echo "job:$id" >> "${PROJECT_ROOT:-..}/runtime/events/jobs.trigger"
}

process_queue() {
    for f in "$JOB_DIR"/*.json; do
        [ -f "$f" ] || continue
        local retries=$(jq -r '.retries' "$f")
        if [ "$retries" -ge "$MAX_RETRIES" ]; then
            mv "$f" "${JOB_DIR}/failed/"
            continue
        fi
        local task=$(jq -r '.task' "$f")
        if bash -c "${task}" 2>/dev/null; then
            rm "$f"
        else
            local id=$(jq -r '.id' "$f")
            jq '.retries += 1' "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
        fi
    done
}
