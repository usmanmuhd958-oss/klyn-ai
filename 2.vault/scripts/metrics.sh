#!/usr/bin/env bash
echo "time=$(date +%s)" > runtime/metrics/system.prom
echo "jobs=$(wc -l < runtime/jobs.jsonl 2>/dev/null || echo 0)" >> runtime/metrics/system.prom
echo "scheduler=$(pgrep -f scheduler.sh | wc -l)" >> runtime/metrics/system.prom
