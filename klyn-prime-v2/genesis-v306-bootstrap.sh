#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v306"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V306] Autonomous AI Global Education Civilization"


DIRS=(
"education-core"
"ai-professor"
"learning-intelligence"
"curriculum-engine"
"teaching-reasoning"
"student-modeling"
"skill-mastery"
"education-memory"
"education-knowledge"
)


for DIR in "${DIRS[@]}"
do
    mkdir -p "$ROOT/$DIR"
done


FILES=(

"$ROOT/education-core/EducationIntelligenceKernel.ts"
"$ROOT/education-core/EducationController.ts"
"$ROOT/education-core/EducationManager.ts"


"$ROOT/ai-professor/AIProfessorEngine.ts"
"$ROOT/ai-professor/TeachingAssistant.ts"


"$ROOT/learning-intelligence/LearningIntelligenceEngine.ts"
"$ROOT/learning-intelligence/LearningOptimizer.ts"


"$ROOT/curriculum-engine/CurriculumGenerationEngine.ts"
"$ROOT/curriculum-engine/CurriculumPlanner.ts"


"$ROOT/teaching-reasoning/TeachingReasoner.ts"
"$ROOT/teaching-reasoning/LessonDesigner.ts"


"$ROOT/student-modeling/StudentKnowledgeModel.ts"
"$ROOT/student-modeling/LearningProfile.ts"


"$ROOT/skill-mastery/SkillMasteryEngine.ts"
"$ROOT/skill-mastery/CompetencyTracker.ts"


"$ROOT/education-memory/EducationMemory.ts"
"$ROOT/education-memory/LearningHistory.ts"


"$ROOT/education-knowledge/EducationKnowledgeGraph.ts"
"$ROOT/education-knowledge/EducationArchive.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V306 READY

 Autonomous AI Global Education Civilization

 Location:
 $ROOT
====================================
"

