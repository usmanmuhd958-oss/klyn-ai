#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

LEDGER="runtime/ledger/jobs.jsonl"
TMP="runtime/ledger/jobs.tmp"

mkdir -p runtime/ledger
touch "$TMP"

while IFS= read -r line; do
  [[ -z "$line" ]] && continue

  # Skip already valid JSON
  echo "$line" | jq empty 2>/dev/null && {
    echo "$line" >> "$TMP"
    continue
  }

  # Try converting legacy format: QUEUED|agent|task|timestamp
  IFS='|' read -r status agent task ts <<< "$line" || true

  if [[ -n "${task:-}" ]]; then
    jq -n \
      --arg id "$(date +%s%N)" \
      --arg status "pending" \
      --arg task "$task" \
      --arg agent "$agent" \
      --arg ts "${ts:-$(date -Iseconds)}" \
      '{
        id: ($id|tonumber),
        status: $status,
        payload: {task: $task, agent: $agent},
        created_at: $ts
      }' >> "$TMP"
  fi
done < "$LEDGER"

mv "$TMP" "$LEDGER"

echo "[MIGRATION] JSONL normalization complete"
