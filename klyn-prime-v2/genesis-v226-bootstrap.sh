#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v226"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V226] Autonomous Global Knowledge & Research Intelligence Civilization"


DIRS=(

"$ROOT/research-kernel"

"$ROOT/knowledge-graph"

"$ROOT/technology-intelligence"

"$ROOT/paper-intelligence"

"$ROOT/experiment-engine"

)


for DIR in "${DIRS[@]}"
do
 mkdir -p "$DIR"
done


FILES=(

"$ROOT/research-kernel/ResearchKernel.ts"
"$ROOT/research-kernel/KnowledgeExplorer.ts"
"$ROOT/research-kernel/DiscoveryEngine.ts"


"$ROOT/knowledge-graph/KnowledgeGraph.ts"
"$ROOT/knowledge-graph/ConceptMapper.ts"
"$ROOT/knowledge-graph/RelationshipEngine.ts"


"$ROOT/technology-intelligence/TechnologyScanner.ts"
"$ROOT/technology-intelligence/TrendAnalyzer.ts"
"$ROOT/technology-intelligence/FuturePrediction.ts"


"$ROOT/paper-intelligence/ResearchAnalyzer.ts"
"$ROOT/paper-intelligence/PaperIndexer.ts"
"$ROOT/paper-intelligence/CitationKnowledge.ts"


"$ROOT/experiment-engine/ExperimentPlanner.ts"
"$ROOT/experiment-engine/HypothesisEngine.ts"
"$ROOT/experiment-engine/ResultMemory.ts"

)


for FILE in "${FILES[@]}"
do
 touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V226 READY

 Autonomous Global Knowledge & Research Intelligence Civilization

 Location:
 $ROOT
====================================
"

