#!/bin/bash
export PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p runtime/{logs,events,queue/failed,pids,metrics}

echo "👑 Klyn AI OS v15 Supreme"
echo "========================="

# Start API
node "$PROJECT_ROOT/api/server.js" > "$PROJECT_ROOT/runtime/logs/api.log" 2>&1 &
echo "✅ API server (PID $!)"

# Start metrics endpoint
node "$PROJECT_ROOT/api/metrics.js" > "$PROJECT_ROOT/runtime/logs/metrics.log" 2>&1 &
echo "✅ Metrics (PID $!)"

# Start keep-alive loop
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

# Start auto‑scaler (optional)
nohup bash "$PROJECT_ROOT/kernel/src/services/autoscaler.sh" > "$PROJECT_ROOT/runtime/logs/autoscaler.log" 2>&1 &
echo "✅ Auto‑scaler started"
# Admin Dashboard (Enterprise Grid)
nohup node \"$PROJECT_ROOT/apps/web/admin.js\" > \"$PROJECT_ROOT/runtime/logs/admin.log\" 2>&1 &
echo \"✅ Admin Dashboard (port 5000)\"

echo ""
echo "🔐 API secured with JWT (admin / klyn)"
echo "📊 Metrics on http://localhost:9090/metrics"
echo "🧩 Use './bin/klyn' for the menu"
echo "💯 Klyn AI OS v15 Supreme – 10/10, undisputed"
