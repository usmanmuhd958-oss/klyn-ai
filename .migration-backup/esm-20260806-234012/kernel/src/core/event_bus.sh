#!/bin/bash
EVENT_DIR="${PROJECT_ROOT:-..}/runtime/events"

publish() {
    local topic="$1"
    local message="$2"
    echo "$message" >> "$EVENT_DIR/$topic"
}

subscribe() {
    local topic="$1"
    # In a real system, use a named pipe or file tailing
    tail -f "$EVENT_DIR/$topic" | while read line; do
        # dispatch to handler
        handle_message "$topic" "$line"
    done
}
