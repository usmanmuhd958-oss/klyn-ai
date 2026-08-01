#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v201"

ROOT="$KLYN_ROOT/genesis/$VERSION"


echo "[GENESIS V201] Core Runtime Civilization"


DIRECTORIES=(

"$ROOT/runtime-kernel"

"$ROOT/system-core"

"$ROOT/health"

"$ROOT/config"

"$ROOT/runtime-memory"

)


for DIR in "${DIRECTORIES[@]}"
do
    mkdir -p "$DIR"
done


FILES=(

"$ROOT/runtime-kernel/RuntimeKernel.ts"
"$ROOT/runtime-kernel/ModuleLoader.ts"
"$ROOT/runtime-kernel/LifecycleManager.ts"


"$ROOT/system-core/SystemRegistry.ts"
"$ROOT/system-core/ServiceManager.ts"


"$ROOT/health/HealthManager.ts"
"$ROOT/health/SystemMonitor.ts"


"$ROOT/config/RuntimeConfig.ts"


"$ROOT/runtime-memory/RuntimeStateMemory.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V201 READY

 Core Runtime Civilization

 Location:
 $ROOT
====================================
"

