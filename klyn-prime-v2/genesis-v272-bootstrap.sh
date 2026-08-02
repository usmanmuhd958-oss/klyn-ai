#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v272"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V272] Autonomous AI Meta-Learning Civilization"


DIRS=(
"learning-core"
"experience-memory"
"self-training"
"skill-evolution"
"error-intelligence"
"performance-learning"
"capability-growth"
"knowledge-adaptation"
)


for DIR in "${DIRS[@]}"
do
    mkdir -p "$ROOT/$DIR"
done


FILES=(

"$ROOT/learning-core/MetaLearningKernel.ts"
"$ROOT/learning-core/LearningController.ts"
"$ROOT/learning-core/IntelligenceImprover.ts"


"$ROOT/experience-memory/ExperienceMemory.ts"
"$ROOT/experience-memory/ExperienceIndexer.ts"
"$ROOT/experience-memory/LessonExtractor.ts"


"$ROOT/self-training/SelfTrainingEngine.ts"
"$ROOT/self-training/TrainingLoop.ts"


"$ROOT/skill-evolution/SkillEvolution.ts"
"$ROOT/skill-evolution/CapabilityMutation.ts"


"$ROOT/error-intelligence/ErrorAnalyzer.ts"
"$ROOT/error-intelligence/FailureLearning.ts"


"$ROOT/performance-learning/PerformanceLearner.ts"
"$ROOT/performance-learning/OptimizationMemory.ts"


"$ROOT/capability-growth/CapabilityGrowthEngine.ts"
"$ROOT/capability-growth/SkillExpansion.ts"


"$ROOT/knowledge-adaptation/KnowledgeAdapter.ts"
"$ROOT/knowledge-adaptation/AdaptiveReasoning.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V272 READY

 Autonomous AI Meta-Learning Civilization

 Location:
 $ROOT
====================================
"

