#!/usr/bin/env bash
set -Eeuo pipefail

health_score() {
    local score=100

    [[ $(find runtime/pids -name '*.pid' 2>/dev/null | wc -l) -eq 0 ]] &&
        score=$((score - 50))

    [[ ! -f runtime/queue/jobs.jsonl ]] &&
        score=$((score - 20))

    [[ ! -d runtime/metrics ]] &&
        score=$((score - 20))

    echo "$score"
}

health_check() {
    mkdir -p runtime runtime/pids runtime/queue runtime/metrics

    local workers queue uptime_str

    workers=$(find runtime/pids -name '*.pid' 2>/dev/null | wc -l)
    queue=$(wc -l < runtime/queue/jobs.jsonl 2>/dev/null || echo 0)
    uptime_str=$(uptime 2>/dev/null || echo "unknown")

    cat > runtime/health.json <<JSON
{
  "status":"healthy",
  "score":"$(health_score)",
  "workers":"$workers",
  "queue":"$queue",
  "uptime":"$uptime_str",
  "time":"$(date -Iseconds)"
}
JSON

    if declare -f metric_inc >/dev/null; then
        metric_inc health_checks
    fi
}
