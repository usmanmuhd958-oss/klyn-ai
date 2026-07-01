#!/data/data/com.termux/files/usr/bin/bash
log_event() { echo "[$(date +%H:%M:%S)] [$1] $2" >> runtime/logs/kernel.log; }
