#!/bin/bash
# ── 1. Environment setup ───────────────────────────────────────────────────────
export KLYN_MASTER_SECRET="edf7408c50da26afccb518861a39d4cbdfbc6a909185"
export KLYN_LOG_LEVEL="info"
export NODE_ENV="production"

# ── 2. Run the Orchestrator ────────────────────────────────────────────────────
node kernel/orchestrator.js
