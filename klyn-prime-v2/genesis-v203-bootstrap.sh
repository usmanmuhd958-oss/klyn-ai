#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="${HOME}/klyn/genesis/v203"

echo "[GENESIS V203] Engineering Knowledge Graph Civilization"


DIRS=(

"$ROOT/knowledge-graph"

"$ROOT/code-intelligence"

"$ROOT/architecture-memory"

"$ROOT/decision-memory"

"$ROOT/learning-system"

"$ROOT/entity-engine"

)


for d in "${DIRS[@]}"
do
 mkdir -p "$d"
done


FILES=(

"$ROOT/knowledge-graph/KnowledgeGraphKernel.ts"
"$ROOT/knowledge-graph/RelationshipEngine.ts"
"$ROOT/knowledge-graph/EntityResolver.ts"


"$ROOT/code-intelligence/CodeEntityAnalyzer.ts"
"$ROOT/code-intelligence/DependencyGraph.ts"


"$ROOT/architecture-memory/ArchitectureMemory.ts"
"$ROOT/architecture-memory/PatternKnowledge.ts"


"$ROOT/decision-memory/DecisionGraph.ts"
"$ROOT/decision-memory/TradeoffMemory.ts"


"$ROOT/learning-system/LessonExtractor.ts"
"$ROOT/learning-system/EngineeringMemory.ts"


"$ROOT/entity-engine/EntityRegistry.ts"

)


for f in "${FILES[@]}"
do
 touch "$f"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V203 READY

 Engineering Knowledge Graph Civilization

 Location:
 $ROOT
====================================
"

