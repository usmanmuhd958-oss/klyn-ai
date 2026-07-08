#!/bin/bash
# Unit test for health check
cd "$(dirname "$0")/../.."
node scripts/health_check.js >/dev/null 2>&1 && echo "[PASS] Health check returns 0" || { echo "[FAIL] Health check failed"; exit 1; }
