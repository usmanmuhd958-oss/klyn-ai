#!/usr/bin/env bash
set -Eeuo pipefail

AGENT_DIR="runtime/state/agents"

register_agent() {
    local name="$1"
    local model="$2"
    local role="$3"

    mkdir -p "$AGENT_DIR"

    cat > "$AGENT_DIR/${name}.json" <<JSON
{
  "name":"$name",
  "model":"$model",
  "role":"$role",
  "status":"ready",
  "registered":"$(date -Iseconds)"
}
JSON
}

list_agents() {
    find "$AGENT_DIR" -name '*.json' \
        -exec basename {} .json \;
}

show_agent() {
    cat "$AGENT_DIR/$1.json"
}
