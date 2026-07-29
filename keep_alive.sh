#!/bin/bash
while true; do
    node kernel/src/execution/evolution_engine.js 2>&1 | tee -a runtime/logs/evolution.log
    sleep 5
done &
while true; do
    node kernel/src/routing/cognitive_router.js 2>&1 | tee -a runtime/logs/cognitive_router.log
    sleep 5
done &
while true; do
    node kernel/src/services/llama_monitor.js 2>&1 | tee -a runtime/logs/llama_monitor.log
    sleep 5
done &
wait
