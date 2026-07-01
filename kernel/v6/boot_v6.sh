#!/data/data/com.termux/files/usr/bin/bash
set -uo pipefail

echo "===================================================="
echo "[KLYN AI OS v6] SPINNING UP DISTRIBUTED NETWORK MESH"
echo "===================================================="

# Enterprise target isolation: kill specific processes, ignoring the orchestrator
pkill -9 -f "node_daemon.sh" || true
pkill -9 -f "master.sh" || true

# Ensure cluster logging target layers are present
mkdir -p runtime/v6/logs

# Boot background microservice components cleanly
bash kernel/v6/cluster/node_daemon.sh "CODER-01" "9001" > runtime/v6/logs/node_9001.log 2>&1 &
bash kernel/v6/cluster/node_daemon.sh "EXEC-02" "9002" > runtime/v6/logs/node_9002.log 2>&1 &
sleep 1
echo "[BOOT] Worker cluster grid mapped over TCP."

# Initialize Master Control Network Interface
bash kernel/v6/core/master.sh > runtime/v6/logs/master.log 2>&1 &
sleep 1

echo "===================================================="
echo "[v6] CLOUD ARCHITECTURE IS FULLY ONLINE (PORT 9000)"
echo "===================================================="
wait
