#!/data/data/com.termux/files/usr/bin/bash
set -uo pipefail

CLUSTER_DIR="runtime/v5/cluster"
HEALTH_DIR="runtime/v5/health"
NODES_FILE="$CLUSTER_DIR/nodes.jsonl"

mkdir -p "$CLUSTER_DIR" "$HEALTH_DIR"
touch "$NODES_FILE"

echo "[v5 CLUSTER] Cluster Manager Online & Monitoring..."

check_health() {
  echo "[$(date +%H:%M:%S)] [v5 CLUSTER] Scanning node health telemetry..."
  if [[ -s "$NODES_FILE" ]]; then
    while read -r node; do
      [[ -z "$node" ]] && continue
      local id=$(echo "$node" | jq -r ".node_id" 2>/dev/null || echo "unknown")
      local role=$(echo "$node" | jq -r ".role" 2>/dev/null || echo "worker")
      local status=$(echo "$node" | jq -r ".status" 2>/dev/null || echo "offline")
      echo "  -> Node [$id] ($role) Status: $status"
    done < "$NODES_FILE"
  else
    echo "  -> [WARN] No active nodes registered in the cluster ledger yet."
  fi
}

while true; do
  check_health
  sleep 5
done
