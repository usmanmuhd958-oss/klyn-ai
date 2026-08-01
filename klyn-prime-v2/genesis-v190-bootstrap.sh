#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v190"

ROOT="$KLYN_ROOT/genesis/$VERSION"


echo "[GENESIS V190] Starting Autonomous Code Intelligence"


DIRECTORIES=(

"$ROOT/code-intelligence"

"$ROOT/repository-analysis"

"$ROOT/dependency-intelligence"

"$ROOT/refactoring-engine"

"$ROOT/architecture-discovery"

"$ROOT/code-memory"

)


for DIR in "${DIRECTORIES[@]}"
do
    mkdir -p "$DIR"
done


FILES=(

"$ROOT/code-intelligence/CodeIntelligenceKernel.ts"
"$ROOT/code-intelligence/CodeReasoningAI.ts"
"$ROOT/code-intelligence/CodeMemory.ts"


"$ROOT/repository-analysis/RepositoryScanner.ts"
"$ROOT/repository-analysis/RepositoryMapper.ts"
"$ROOT/repository-analysis/RepositoryGraph.ts"


"$ROOT/dependency-intelligence/DependencyAnalyzer.ts"
"$ROOT/dependency-intelligence/DependencyGraph.ts"


"$ROOT/refactoring-engine/SafeRefactorAI.ts"
"$ROOT/refactoring-engine/RefactorPlanner.ts"


"$ROOT/architecture-discovery/ArchitectureDetector.ts"
"$ROOT/architecture-discovery/SystemMap.ts"


"$ROOT/code-memory/CodeKnowledgeBase.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V190 READY

 Autonomous Code Intelligence

 Location:
 $ROOT
====================================
"

