#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BENCH_FILE="$PROJECT_ROOT/runtime/benchmark_history.jsonl"

benchmark() {
    local ts=$(date -Iseconds)
    local health=$(node "$PROJECT_ROOT/scripts/health_check.js" 2>/dev/null | grep -c PASS)
    local services=$(pgrep -c "node" 2>/dev/null)
    local memory=$(free -m | awk '/Mem:/ {print $3}')
    local disk=$(df /data | awk 'NR==2 {print $5}' | sed 's/%//')
    echo "{\"ts\":\"$ts\",\"health\":$health,\"services\":$services,\"memory_mb\":$memory,\"disk_percent\":$disk}" >> "$BENCH_FILE"
    echo "Benchmark recorded: health=$health, services=$services, memory=${memory}MB, disk=${disk}%"
}
benchmark
