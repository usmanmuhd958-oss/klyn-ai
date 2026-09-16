#!/usr/bin/env bash
set -Eeuo pipefail

register_agent() {
    local name="$1"
    local model="$2"

    mkdir -p runtime/agents

    cat > "runtime/agents/$name.json" <<JSON
{
  "name":"$name",
  "model":"$model",
  "status":"idle",
  "created":"$(date -Iseconds)"
}
JSON
}

list_agents() {
    find runtime/agents \
        -name '*.json' \
        -exec basename {} .json \; \
        2>/dev/null || true
}

agent_status() {
    local name="$1"

    cat "runtime/agents/$name.json" \
        2>/dev/null || echo "Agent not found"
}
