#!/usr/bin/env bash

set -e

echo "======================================"
echo " FIXING AGENT RUNTIME ROOT EXPORT"
echo "======================================"

ROOT="packages/agent-runtime/src"

mkdir -p "$ROOT"

cat > "$ROOT/index.ts" <<'TS'
/**
 * KLYN Agent Runtime Public API
 * Canonical Export Boundary
 */

export * from "./executor/index.js";

export * from "./runtime/AgentRuntime.js";
export * from "./runtime/OrchestrationRuntime.js";

export * from "./memory/SupabaseAgentMemory.js";

export * from "./queue/AgentQueue.js";

export * from "./retry/RetryManager.js";

export * from "./scheduler/TaskScheduler.js";

export * from "./validation/AgentValidator.js";

export * from "./types/agent.types.js";
TS


echo "✅ agent-runtime root index.ts created"


echo ""
echo "Checking executor export..."

if ! grep -q "AgentExecutor" "$ROOT/executor/index.ts"; then

cat >> "$ROOT/executor/index.ts" <<'TS'

export * from "./AgentExecutor.js";

TS

fi


echo "✅ executor exports verified"


echo ""
echo "Running TypeScript check..."

npm run typecheck


echo ""
echo "======================================"
echo " AGENT RUNTIME EXPORT FIX COMPLETE"
echo "======================================"
