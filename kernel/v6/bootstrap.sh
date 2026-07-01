#!/bin/bash
set -euo pipefail

echo "[BOOTSTRAP] v6 cluster initializing..."

mkdir -p runtime/v6/{queue,cluster,state,logs,ledger}

touch runtime/v6/queue/jobs.jsonl
touch runtime/v6/cluster/nodes.jsonl

if [[ ! -f runtime/v6/state/cluster.json ]]; then
cat > runtime/v6/state/cluster.json <<EOL
{
  "status": "running",
  "version": "v6",
  "leader": "local"
}
EOL
fi

echo "[BOOTSTRAP] OK"
