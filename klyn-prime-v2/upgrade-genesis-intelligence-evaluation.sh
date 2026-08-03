#!/usr/bin/env bash

BASE="prime-core-system/genesis/intelligence-evaluation"

mkdir -p $BASE

touch \
$BASE/IntelligenceEvaluator.ts \
$BASE/ReasoningQualityAnalyzer.ts \
$BASE/DecisionAccuracyTracker.ts \
$BASE/PredictionEvaluator.ts \
$BASE/CapabilityEffectiveness.ts \
$BASE/LearningScoreEngine.ts \
$BASE/ExperimentEvaluator.ts \
$BASE/TruthValidationEngine.ts \
$BASE/PerformanceBenchmark.ts \
$BASE/IntelligenceMetrics.ts

echo "[KLYN PRIME] Genesis Intelligence Evaluation Layer Activated"

