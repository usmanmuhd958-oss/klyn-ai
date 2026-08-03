#!/usr/bin/env bash

BASE="prime-core-system/genesis/intelligence-graph"

mkdir -p $BASE

touch \
$BASE/IntelligenceGraph.ts \
$BASE/KnowledgeRelationshipEngine.ts \
$BASE/DecisionGraph.ts \
$BASE/AgentCapabilityGraph.ts \
$BASE/ExperienceGraph.ts \
$BASE/CausalIntelligenceEngine.ts

echo "[KLYN PRIME] Genesis Unified Intelligence Graph Activated"

