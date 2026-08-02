#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v221"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V221] Autonomous Enterprise Memory Operating System"


DIRS=(

"$ROOT/memory-os"

"$ROOT/event-memory"

"$ROOT/decision-archaeology"

"$ROOT/engineering-memory"

"$ROOT/memory-intelligence"

)


for DIR in "${DIRS[@]}"
do
 mkdir -p "$DIR"
done


FILES=(

"$ROOT/memory-os/MemoryKernel.ts"
"$ROOT/memory-os/MemoryController.ts"
"$ROOT/memory-os/MemoryLifecycle.ts"


"$ROOT/event-memory/EventStore.ts"
"$ROOT/event-memory/TimelineEngine.ts"
"$ROOT/event-memory/HistoryReconstructor.ts"


"$ROOT/decision-archaeology/DecisionArchive.ts"
"$ROOT/decision-archaeology/DecisionExplorer.ts"
"$ROOT/decision-archaeology/ReasoningHistory.ts"


"$ROOT/engineering-memory/ProjectMemory.ts"
"$ROOT/engineering-memory/ArchitectureMemory.ts"
"$ROOT/engineering-memory/FailureMemory.ts"


"$ROOT/memory-intelligence/MemorySearch.ts"
"$ROOT/memory-intelligence/MemoryRanking.ts"
"$ROOT/memory-intelligence/MemoryOptimizer.ts"

)


for FILE in "${FILES[@]}"
do
 touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V221 READY

 Autonomous Enterprise Memory Operating System

 Location:
 $ROOT
====================================
"

