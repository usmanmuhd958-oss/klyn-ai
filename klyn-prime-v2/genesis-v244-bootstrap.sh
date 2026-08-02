#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v244"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V244] Autonomous Repository Intelligence Civilization"


DIRS=(
"repository-intelligence"
"dependency-intelligence"
"architecture-discovery"
"code-understanding"
"refactoring-intelligence"
)


for DIR in "${DIRS[@]}"
do
    mkdir -p "$ROOT/$DIR"
done


FILES=(

"$ROOT/repository-intelligence/RepositoryScanner.ts"
"$ROOT/repository-intelligence/RepositoryMap.ts"
"$ROOT/repository-intelligence/SourceAnalyzer.ts"


"$ROOT/dependency-intelligence/DependencyGraph.ts"
"$ROOT/dependency-intelligence/DependencyAnalyzer.ts"
"$ROOT/dependency-intelligence/ImpactAnalyzer.ts"


"$ROOT/architecture-discovery/ArchitectureDetector.ts"
"$ROOT/architecture-discovery/ComponentMapper.ts"
"$ROOT/architecture-discovery/SystemVisualizer.ts"


"$ROOT/code-understanding/CodeSemanticAnalyzer.ts"
"$ROOT/code-understanding/CodeKnowledge.ts"
"$ROOT/code-understanding/ChangeReasoner.ts"


"$ROOT/refactoring-intelligence/RefactorPlanner.ts"
"$ROOT/refactoring-intelligence/SafetyChecker.ts"
"$ROOT/refactoring-intelligence/MigrationAdvisor.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V244 READY

 Autonomous Repository Intelligence Civilization

 Location:
 $ROOT
====================================
"
