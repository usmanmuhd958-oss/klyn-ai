#!/usr/bin/env bash

BASE="prime-core-system/genesis/runtime-core"

mkdir -p $BASE

touch \
$BASE/GenesisRuntime.ts \
$BASE/RuntimeScheduler.ts \
$BASE/TaskExecutionGraph.ts \
$BASE/AgentRuntimeManager.ts \
$BASE/IntelligenceSession.ts \
$BASE/ContextMemoryManager.ts \
$BASE/LearningFeedbackLoop.ts \
$BASE/RuntimeVerifier.ts \
$BASE/RuntimeMetrics.ts

echo "[KLYN PRIME] Genesis Runtime Core Activated"

