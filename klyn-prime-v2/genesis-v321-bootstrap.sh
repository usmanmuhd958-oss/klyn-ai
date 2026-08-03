#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v321"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V321] Autonomous AI Global Research & Innovation Civilization"


DIRS=(
"research-core"
"ai-scientists"
"hypothesis-engine"
"experiment-planning"
"simulation-intelligence"
"innovation-engine"
"scientific-integration"
"discovery-memory"
"research-collaboration"
)


for DIR in "${DIRS[@]}"
do
    mkdir -p "$ROOT/$DIR"
done


FILES=(

"$ROOT/research-core/ResearchKernel.ts"
"$ROOT/research-core/ResearchController.ts"
"$ROOT/research-core/ResearchManager.ts"


"$ROOT/ai-scientists/AIScientistAgent.ts"
"$ROOT/ai-scientists/ScientificTeamOrchestrator.ts"


"$ROOT/hypothesis-engine/HypothesisGenerationEngine.ts"
"$ROOT/hypothesis-engine/HypothesisEvaluator.ts"


"$ROOT/experiment-planning/ExperimentPlanner.ts"
"$ROOT/experiment-planning/ResearchWorkflow.ts"


"$ROOT/simulation-intelligence/SimulationReasoningEngine.ts"
"$ROOT/simulation-intelligence/SimulationManager.ts"


"$ROOT/innovation-engine/InnovationEngine.ts"
"$ROOT/innovation-engine/IdeaGenerator.ts"


"$ROOT/scientific-integration/ScientificKnowledgeIntegrator.ts"
"$ROOT/scientific-integration/PaperAnalyzer.ts"


"$ROOT/discovery-memory/DiscoveryMemory.ts"
"$ROOT/discovery-memory/ResearchHistory.ts"


"$ROOT/research-collaboration/ResearchCollaborationNetwork.ts"
"$ROOT/research-collaboration/ScientificAgentNetwork.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V321 READY

 Autonomous AI Global Research & Innovation Civilization

 Location:
 $ROOT
====================================
"

