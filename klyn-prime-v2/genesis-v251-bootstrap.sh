#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v251"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V251] Autonomous Agent Operating System Layer"


DIRS=(
"agent-kernel"
"agent-identity"
"agent-runtime"
"agent-permissions"
"agent-tools"
"agent-communication"
"agent-governance"
)


for DIR in "${DIRS[@]}"
do
    mkdir -p "$ROOT/$DIR"
done


FILES=(

"$ROOT/agent-kernel/AgentKernel.ts"
"$ROOT/agent-kernel/AgentSupervisor.ts"
"$ROOT/agent-kernel/AgentLifecycle.ts"


"$ROOT/agent-identity/AgentIdentity.ts"
"$ROOT/agent-identity/AgentRegistry.ts"
"$ROOT/agent-identity/AgentProfile.ts"


"$ROOT/agent-runtime/AgentExecutor.ts"
"$ROOT/agent-runtime/AgentScheduler.ts"
"$ROOT/agent-runtime/AgentState.ts"


"$ROOT/agent-permissions/PermissionEngine.ts"
"$ROOT/agent-permissions/CapabilityManager.ts"
"$ROOT/agent-permissions/AccessControl.ts"


"$ROOT/agent-tools/ToolRegistry.ts"
"$ROOT/agent-tools/ToolExecutor.ts"
"$ROOT/agent-tools/ToolPolicy.ts"


"$ROOT/agent-communication/AgentMessageBus.ts"
"$ROOT/agent-communication/CollaborationProtocol.ts"
"$ROOT/agent-communication/AgentNetwork.ts"


"$ROOT/agent-governance/AgentRules.ts"
"$ROOT/agent-governance/AgentAudit.ts"
"$ROOT/agent-governance/AgentCompliance.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V251 READY

 Autonomous Agent Operating System Layer

 Location:
 $ROOT
====================================
"

