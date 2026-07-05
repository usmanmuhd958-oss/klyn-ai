#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

mkdir -p runtime/goals

goal="$*"

cat > runtime/goals/latest.json << JSON
{
  "goal": "$goal",
  "created_at": "$(date -u +%FT%TZ)"
}
JSON

echo "[KLYN] Goal registered: $goal"
