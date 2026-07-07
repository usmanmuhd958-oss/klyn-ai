#!/bin/bash
export PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p runtime/{logs,events,queue/failed,pids,metrics}

echo "👑 Klyn AI OS v14 Platinum"
echo "============================"
rm -f /tmp/klyn_api_ready

# Start API
node "$PROJECT_ROOT/api/server.js" > "$PROJECT_ROOT/runtime/logs/api.log" 2>&1 &
API_PID=$!
echo "✅ API server (PID $API_PID)"

# Wait until API signals readiness (file flag)
for i in {1..10}; do
    if curl -s http://localhost:3000/status >/dev/null 2>&1; then
        echo "✅ API ready on port 3000"
        break
    fi
    sleep 1
done

# Keep-alive loop
nohup bash -c '
while true; do
    if ! pgrep -f "node api/server.js" >/dev/null; then
        echo "[$(date)] API died, restarting..."
        node '"$PROJECT_ROOT"'/api/server.js >> '"$PROJECT_ROOT"'/runtime/logs/api.log 2>&1 &
    fi
    sleep 5
done
' > "$PROJECT_ROOT/runtime/logs/keepalive.log" 2>&1 &

echo "✅ Keep-alive started"
echo ""
echo "🔐 API secured with JWT (default admin / klyn)"
echo "🛠️  Use './bin/klyn' for the menu"
echo "💯 Klyn AI OS v14 Platinum – 10/10"
