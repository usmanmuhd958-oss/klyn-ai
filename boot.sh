#!/bin/bash
export PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p runtime/{logs,events,queue/failed,pids,metrics}

echo "👑 Klyn AI OS v18 Supreme"
echo "========================="

# API Server
node "$PROJECT_ROOT/api/server.js" > "$PROJECT_ROOT/runtime/logs/api.log" 2>&1 &
echo "✅ API server (PID $!)"

# Metrics Endpoint
node "$PROJECT_ROOT/api/metrics.js" > "$PROJECT_ROOT/runtime/logs/metrics.log" 2>&1 &
echo "✅ Metrics (PID $!)"

# Keep‑alive daemon
nohup bash -c '
while true; do
    if ! pgrep -f "node api/server.js" >/dev/null; then
        echo "[$(date)] API died, restarting..."
        node '"$PROJECT_ROOT"'/api/server.js >> '"$PROJECT_ROOT"'/runtime/logs/api.log 2>&1 &
    fi
    sleep 5
done
' > "$PROJECT_ROOT/runtime/logs/keepalive.log" 2>&1 &
echo "✅ Keep‑alive started"

# Auto‑scaler
nohup bash "$PROJECT_ROOT/kernel/src/services/autoscaler.sh" > "$PROJECT_ROOT/runtime/logs/autoscaler.log" 2>&1 &
echo "✅ Auto‑scaler started"

# Enterprise Admin Dashboard
mkdir -p "$PROJECT_ROOT/runtime/logs"
nohup node "$PROJECT_ROOT/apps/web/admin.js" > "$PROJECT_ROOT/runtime/logs/admin.log" 2>&1 &
echo "✅ Admin Dashboard (port 5000)"
# Global API Gateway (port 8000)
nohup bash api/gateway.sh > runtime/logs/gateway.log 2>&1 &
echo "✅ Global API Gateway (port 8000)"

# Web Code Editor (port 8080)
nohup bash dashboard/web_editor.sh > runtime/logs/web_editor.log 2>&1 &
echo "✅ Web Code Editor (port 8080)"

# Autonomous Self‑Improvement Scheduler (runs every 6 hours)
nohup bash "$PROJECT_ROOT/kernel/src/services/improvement_scheduler.sh" > "$PROJECT_ROOT/runtime/logs/autonomous_improver.log" 2>&1 &
echo "✅ Autonomous Self‑Improvement (every 6h)"

echo ""
echo "🔐 API secured with JWT (admin / klyn)"
echo "📊 Metrics on http://localhost:9090/metrics"
echo "🏛️ Admin Dashboard on http://localhost:5000"
echo "🧩 Use './bin/klyn' for the menu"
echo "💯 Klyn AI OS v18 Supreme – 10/10, self‑evolving, undisputed"
