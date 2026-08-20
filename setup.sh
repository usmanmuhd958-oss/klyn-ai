#!/bin/bash
# ── 1. Environment setup ───────────────────────────────────────────────────────
# KLYN_MASTER_SECRET must be provided by the operator (never commit secrets).
: "${KLYN_MASTER_SECRET:?KLYN_MASTER_SECRET must be set in the environment}"
export KLYN_LOG_LEVEL="info"
export NODE_ENV="production"

# ── 2. Run the Orchestrator ────────────────────────────────────────────────────
node kernel/orchestrator.js
