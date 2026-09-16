#!/usr/bin/env bash
# Simple log rotation – truncate files larger than 10 MB
set -euo pipefail
MAX_SIZE_MB=10
LOGDIR="$HOME/klyn-ai-os/runtime/logs"
cd "$LOGDIR"

for log in *.log; do
    if [ -f "$log" ]; then
        size=$(stat -c%s "$log" 2>/dev/null || echo 0)
        if [ "$size" -gt $((MAX_SIZE_MB * 1024 * 1024)) ]; then
            mv "$log" "$log.old-$(date +%Y%m%d-%H%M%S)"
            touch "$log"
            echo "[$(date)] Rotated $log (was $(du -h "$log.old-"* | tail -1 | awk '{print $1}'))"
        fi
    fi
done
