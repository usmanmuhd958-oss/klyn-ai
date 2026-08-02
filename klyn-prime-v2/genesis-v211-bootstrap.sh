#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v211"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V211] Autonomous Research Civilization"


DIRS=(

"$ROOT/research-core"

"$ROOT/technology-intelligence"

"$ROOT/architecture-research"

"$ROOT/experiment-engine"

"$ROOT/research-memory"

)


for DIR in "${DIRS[@]}"
do
 mkdir -p "$DIR"
done


FILES=(

"$ROOT/research-core/ResearchKernel.ts"
"$ROOT/research-core/KnowledgeExplorer.ts"
"$ROOT/research-core/ResearchPlanner.ts"


"$ROOT/technology-intelligence/TechnologyAnalyzer.ts"
"$ROOT/technology-intelligence/FrameworkEvaluator.ts"
"$ROOT/technology-intelligence/ToolComparison.ts"


"$ROOT/architecture-research/ArchitectureResearcher.ts"
"$ROOT/architecture-research/DesignEvaluator.ts"
"$ROOT/architecture-research/ArchitectureReport.ts"


"$ROOT/experiment-engine/ExperimentPlanner.ts"
"$ROOT/experiment-engine/HypothesisEngine.ts"
"$ROOT/experiment-engine/ResultAnalyzer.ts"


"$ROOT/research-memory/ResearchArchive.ts"
"$ROOT/research-memory/FindingMemory.ts"
"$ROOT/research-memory/InsightRepository.ts"

)


for FILE in "${FILES[@]}"
do
 touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V211 READY

 Autonomous Research Civilization

 Location:
 $ROOT
====================================
"

