#!/data/data/com.termux/files/usr/bin/bash

set -e

mkdir -p architecture/graph

echo "{ \"dependencies\": [" > architecture/graph/dependency-graph.json

grep -R "import .*from" \
packages kernel intelligence core agents \
--include="*.ts" \
| sed 's/^/"/;s/$/",/' \
>> architecture/graph/dependency-graph.json

echo "]}" >> architecture/graph/dependency-graph.json

echo "[GRAPH] Dependency graph generated"
