#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

type="${1:-}"
name="${2:-}"

mkdir -p apps/api

cat > "apps/api/${name}.json" << JSON
{
  "type": "$type",
  "name": "$name"
}
JSON

echo "[KLYN] Generated $type: $name"
