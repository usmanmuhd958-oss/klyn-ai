#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v311"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V311] Autonomous AI Civilization Operating Kernel"


DIRS=(
"kernel-core"
"genesis-registry"
"layer-orchestration"
"intelligence-routing"
"runtime-controller"
"evolution-manager"
"civilization-memory"
"system-state"
"module-discovery"
)


for DIR in "${DIRS[@]}"
do
    mkdir -p "$ROOT/$DIR"
done


FILES=(

"$ROOT/kernel-core/CivilizationKernel.ts"
"$ROOT/kernel-core/KernelController.ts"
"$ROOT/kernel-core/KernelManager.ts"


"$ROOT/genesis-registry/GenesisRegistry.ts"
"$ROOT/genesis-registry/LayerRegistry.ts"


"$ROOT/layer-orchestration/LayerOrchestrator.ts"
"$ROOT/layer-orchestration/CivilizationCoordinator.ts"


"$ROOT/intelligence-routing/IntelligenceRouter.ts"
"$ROOT/intelligence-routing/DecisionRouter.ts"


"$ROOT/runtime-controller/CivilizationRuntime.ts"
"$ROOT/runtime-controller/RuntimeManager.ts"


"$ROOT/evolution-manager/EvolutionController.ts"
"$ROOT/evolution-manager/SelfImprovementEngine.ts"


"$ROOT/civilization-memory/CivilizationMemory.ts"
"$ROOT/civilization-memory/GenesisHistory.ts"


"$ROOT/system-state/SystemStateManager.ts"
"$ROOT/system-state/StateMonitor.ts"


"$ROOT/module-discovery/ModuleDiscoveryEngine.ts"
"$ROOT/module-discovery/CapabilityScanner.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V311 READY

 Autonomous AI Civilization Operating Kernel

 Location:
 $ROOT
====================================
"

