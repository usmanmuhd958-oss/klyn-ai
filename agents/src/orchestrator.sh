#!/bin/bash
# Pure Bash Orchestrator – replaces AIOrchestrator.ts
# Reads agent manifests from runtime/agents/*.json, validates, and launches pipeline.

set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST_DIR="$PROJECT_ROOT/runtime/agents"
LOG="$PROJECT_ROOT/runtime/logs/orchestrator.log"

log() { echo "[$(date -Iseconds)] $1" >> "$LOG"; }

# Create a mutable copy of any JSON manifest (sealed objects don't exist in Bash)
load_manifest() {
    local file="$1"
    if [ ! -f "$file" ]; then
        log "ERROR: Manifest not found: $file"
        return 1
    fi
    # jq reads JSON and outputs it – always mutable in Bash
    cat "$file" | jq -c '.'
}

# Validate required fields
validate_manifest() {
    local json="$1"
    local id=$(echo "$json" | jq -r '.id // empty')
    local name=$(echo "$json" | jq -r '.name // empty')
    if [ -z "$id" ] || [ -z "$name" ]; then
        log "ERROR: Invalid manifest – missing id or name"
        return 1
    fi
    echo "$json"  # pass through if valid
    return 0
}

# Main orchestrator
log "Starting Bash Orchestrator..."

# Find all agent manifests
manifests=$(ls "$MANIFEST_DIR"/*.json 2>/dev/null || true)
if [ -z "$manifests" ]; then
    log "WARNING: No agent manifests found in $MANIFEST_DIR"
fi

for mf in $manifests; do
    log "Loading manifest: $mf"
    manifest_json=$(load_manifest "$mf") || continue

    if ! validated=$(validate_manifest "$manifest_json"); then
        log "Skipping invalid manifest: $mf"
        continue
    fi

    agent_name=$(echo "$validated" | jq -r '.name')
    agent_type=$(echo "$validated" | jq -r '.type // "coder"')
    log "Registered agent: $agent_name (type: $agent_type)"

    # Launch the agent pipeline (planner -> coder -> reviewer)
    log "Launching pipeline for $agent_name..."
    # Example: call existing agents with the tasks defined in the manifest
    bash "$PROJECT_ROOT/agents/src/planner.sh" "$agent_name" &
    bash "$PROJECT_ROOT/agents/src/coder.sh" "$agent_name" &
    bash "$PROJECT_ROOT/agents/src/reviewer.sh" "$agent_name" &
done

log "Orchestrator initialization complete."

# Keep running to monitor agents (if needed)
wait
