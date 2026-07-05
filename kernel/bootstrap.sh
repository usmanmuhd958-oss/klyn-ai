#!/usr/bin/env bash
set -Eeuo pipefail

for f in \
    kernel/metrics.sh \
    kernel/event_bus.sh \
    kernel/memory.sh \
    kernel/router.sh \
    kernel/queue.sh \
    kernel/agent_runtime.sh \
    kernel/services.sh \
    kernel/audit.sh
do
    [[ -f "$f" ]] && source "$f"
done
