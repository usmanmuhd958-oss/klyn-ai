#!/bin/bash
# Store actions when offline, replay when online
QUEUE_DIR="${PROJECT_ROOT:-..}/runtime/offline_queue"

enqueue() {
    local action="$1"
    echo "$action" >> "$QUEUE_DIR/pending.log"
}

replay_queue() {
    while IFS= read -r line; do
        # process action (simplified)
        echo "Replaying: $line"
    done < "$QUEUE_DIR/pending.log"
    > "$QUEUE_DIR/pending.log"  # clear
}
