#!/data/data/com.termux/files/usr/bin/bash

NODES=("node1" "node2" "node3")

echo "[CLUSTER v5] Starting distributed nodes..."

for node in "${NODES[@]}"; do
  bash kernel/v5/cluster/node.sh "$node" &
done

echo "[CLUSTER v5] Launched ${#NODES[@]} active nodes in the background."
wait
