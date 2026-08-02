#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v255"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V255] Autonomous AI Research & Model Intelligence Civilization"


DIRS=(
"ai-core"
"model-router"
"research-engine"
"knowledge-synthesis"
"prompt-intelligence"
"model-memory"
"evaluation-engine"
)


for DIR in "${DIRS[@]}"
do
    mkdir -p "$ROOT/$DIR"
done


FILES=(

"$ROOT/ai-core/AIIntelligenceCore.ts"
"$ROOT/ai-core/ReasoningEngine.ts"
"$ROOT/ai-core/AIController.ts"


"$ROOT/model-router/ModelRouter.ts"
"$ROOT/model-router/ModelSelector.ts"
"$ROOT/model-router/ProviderManager.ts"


"$ROOT/research-engine/ResearchAgent.ts"
"$ROOT/research-engine/ResearchPlanner.ts"
"$ROOT/research-engine/KnowledgeExplorer.ts"


"$ROOT/knowledge-synthesis/KnowledgeGraph.ts"
"$ROOT/knowledge-synthesis/SynthesisEngine.ts"
"$ROOT/knowledge-synthesis/InsightGenerator.ts"


"$ROOT/prompt-intelligence/PromptOptimizer.ts"
"$ROOT/prompt-intelligence/PromptAnalyzer.ts"
"$ROOT/prompt-intelligence/PromptEvolution.ts"


"$ROOT/model-memory/ModelMemory.ts"
"$ROOT/model-memory/ConversationMemory.ts"
"$ROOT/model-memory/EngineeringMemory.ts"


"$ROOT/evaluation-engine/ModelEvaluator.ts"
"$ROOT/evaluation-engine/BenchmarkEngine.ts"
"$ROOT/evaluation-engine/QualityScorer.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V255 READY

 Autonomous AI Research & Model Intelligence Civilization

 Location:
 $ROOT
====================================
"

