#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v202"

ROOT="$KLYN_ROOT/genesis/$VERSION"


echo "[GENESIS V202] Agent Civilization Runtime"


DIRECTORIES=(

"$ROOT/agent-kernel"

"$ROOT/agent-runtime"

"$ROOT/agent-memory"

"$ROOT/agent-tools"

"$ROOT/agent-communication"

"$ROOT/agent-governance"

)


for DIR in "${DIRECTORIES[@]}"
do
    mkdir -p "$DIR"
done


FILES=(

"$ROOT/agent-kernel/AgentKernel.ts"
"$ROOT/agent-kernel/AgentLifecycle.ts"


"$ROOT/agent-runtime/AgentExecutor.ts"
"$ROOT/agent-runtime/AgentPlanner.ts"
"$ROOT/agent-runtime/AgentState.ts"


"$ROOT/agent-memory/AgentMemory.ts"
"$ROOT/agent-memory/ExperienceStore.ts"


"$ROOT/agent-tools/ToolRegistry.ts"
"$ROOT/agent-tools/ToolExecutor.ts"


"$ROOT/agent-communication/AgentMessageBus.ts"
"$ROOT/agent-communication/AgentProtocol.ts"


"$ROOT/agent-governance/AgentPolicy.ts"
"$ROOT/agent-governance/AgentPermission.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V202 READY

 Agent Civilization Runtime

 Location:
 $ROOT
====================================
"

