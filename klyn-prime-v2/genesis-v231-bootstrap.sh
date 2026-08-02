#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v231"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V231] Autonomous Software Evolution Engine"


DIRS=(

"$ROOT/evolution-kernel"

"$ROOT/code-evolution"

"$ROOT/technical-debt"

"$ROOT/quality-intelligence"

"$ROOT/learning-loop"

)


for DIR in "${DIRS[@]}"
do
 mkdir -p "$DIR"
done


FILES=(

"$ROOT/evolution-kernel/EvolutionKernel.ts"
"$ROOT/evolution-kernel/ImprovementPlanner.ts"
"$ROOT/evolution-kernel/EvolutionCycle.ts"


"$ROOT/code-evolution/CodeAnalyzer.ts"
"$ROOT/code-evolution/RefactoringAdvisor.ts"
"$ROOT/code-evolution/MigrationPlanner.ts"


"$ROOT/technical-debt/DebtDetector.ts"
"$ROOT/technical-debt/DebtPrioritizer.ts"
"$ROOT/technical-debt/DebtResolution.ts"


"$ROOT/quality-intelligence/QualityAnalyzer.ts"
"$ROOT/quality-intelligence/EngineeringMetrics.ts"
"$ROOT/quality-intelligence/QualityScore.ts"


"$ROOT/learning-loop/FeedbackAnalyzer.ts"
"$ROOT/learning-loop/ExperienceLearner.ts"
"$ROOT/learning-loop/EvolutionMemory.ts"

)


for FILE in "${FILES[@]}"
do
 touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V231 READY

 Autonomous Software Evolution Engine

 Location:
 $ROOT
====================================
"

