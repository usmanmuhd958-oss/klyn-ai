#!/usr/bin/env bash

set -e

ROOT="$HOME/klyn-ai-os"

echo "[CANONICAL] Starting module consolidation"

mkdir -p architecture/registry

cat > architecture/registry/CANONICAL_MODULES.md <<'EOF'
# KLYN Canonical Module Authority

## Runtime

Canonical:
packages/agent-runtime/src/runtime/AgentRuntime.ts


## Executor

Canonical:
packages/agent-runtime/src/executor/AgentExecutor.ts


## AI Gateway

Canonical:
packages/ai-gateway/src/gateway/AIEngine.ts


## Workflow

Canonical:
packages/workflow-engine/src/WorkflowEngine.ts


## Memory

Canonical:
intelligence/memory/MemoryEngine.ts


EOF


echo "[CANONICAL] Registry created"
