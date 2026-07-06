#!/bin/bash
PIDS_DIR="${PROJECT_ROOT:-..}/runtime/pids"
start_service() {
    local name="$1"
    local cmd="$2"
    $cmd &
    echo $! > "$PIDS_DIR/$name.pid"
    echo "Started $name (PID $(cat $PIDS_DIR/$name.pid))"
}
stop_service() {
    local name="$1"
    if [ -f "$PIDS_DIR/$name.pid" ]; then
        kill $(cat "$PIDS_DIR/$name.pid") 2>/dev/null
        rm "$PIDS_DIR/$name.pid"
    fi
}
list_services() {
    for pidfile in "$PIDS_DIR"/*.pid; do
        [ -f "$pidfile" ] || continue
        local name=$(basename "$pidfile" .pid)
        local pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            echo "$name (RUNNING, PID $pid)"
        else
            echo "$name (DEAD)"
        fi
    done
}
