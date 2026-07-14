#!/data/data/com.termux/files/usr/bin/bash
# =============================================================================
# KLYN AI OS – Autonomous Dry‑Run Test (Termux‑Safe)
# =============================================================================
set -euo pipefail

KLYN_ROOT="/data/data/com.termux/files/home/klyn-ai-os"

# --- Test 1: Evolution Engine health ---
echo "=== Test 1: Evolution Engine ==="
if pgrep -f evolution_engine.js >/dev/null; then
    echo "[PASS] Evolution Engine is running"
else
    echo "[FAIL] Evolution Engine is not running"
    exit 1
fi

# --- Test 2: Cognitive Router health ---
echo "=== Test 2: Cognitive Router ==="
if pgrep -f cognitive_router.js >/dev/null; then
    echo "[PASS] Cognitive Router is running"
else
    echo "[FAIL] Cognitive Router is not running"
    exit 1
fi

# --- Test 3: LLM Monitor health ---
echo "=== Test 3: LLM Monitor ==="
if pgrep -f llama_monitor.js >/dev/null; then
    echo "[PASS] LLM Monitor is running"
else
    echo "[FAIL] LLM Monitor is not running"
    exit 1
fi

# --- Test 4: API health ---
echo "=== Test 4: API Server ==="
API_STATUS=$(curl -s http://localhost:3000/status 2>/dev/null || echo '{"status":"unhealthy"}')
if echo "$API_STATUS" | grep -q 'healthy'; then
    echo "[PASS] API Server is healthy"
else
    echo "[FAIL] API Server is not responding"
    exit 1
fi

# --- Test 5: State Engine ---
echo "=== Test 5: State Engine ==="
node "$KLYN_ROOT/scripts/health_check.js" >/dev/null 2>&1 && echo "[PASS] State Engine is healthy" || {
    echo "[FAIL] State Engine check failed"
    exit 1
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[✓] All dry‑run tests passed – Klyn AI OS is healthy."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
