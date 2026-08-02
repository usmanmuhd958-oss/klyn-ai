#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v204"

ROOT="$KLYN_ROOT/genesis/$VERSION"


echo "[GENESIS V204] Autonomous Software Factory Civilization"


DIRS=(

"$ROOT/software-factory"

"$ROOT/engineering-pipeline"

"$ROOT/project-intelligence"

"$ROOT/quality-engine"

"$ROOT/release-intelligence"

)


for DIR in "${DIRS[@]}"
do
 mkdir -p "$DIR"
done


FILES=(

"$ROOT/software-factory/RequirementAnalyzer.ts"
"$ROOT/software-factory/ArchitecturePlanner.ts"
"$ROOT/software-factory/ImplementationPlanner.ts"
"$ROOT/software-factory/CodeGenerationPlanner.ts"
"$ROOT/software-factory/ReviewCoordinator.ts"


"$ROOT/engineering-pipeline/BuildPipeline.ts"
"$ROOT/engineering-pipeline/TestPipeline.ts"
"$ROOT/engineering-pipeline/QualityGate.ts"


"$ROOT/project-intelligence/ProjectUnderstanding.ts"
"$ROOT/project-intelligence/ComplexityEstimator.ts"


"$ROOT/quality-engine/QualityAnalyzer.ts"


"$ROOT/release-intelligence/ReleasePlanner.ts"

)


for FILE in "${FILES[@]}"
do
 touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V204 READY

 Autonomous Software Factory Civilization

 Location:
 $ROOT
====================================
"

