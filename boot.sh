#!/bin/bash
export PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p runtime/{logs,events,queue/failed,pids,metrics}

echo "🚀 Klyn AI OS v13 Enterprise"
echo "============================"

# Clean up any old ready flag
rm -f /tmp/klyn_api_ready

# Start API server
node "$PROJECT_ROOT/api/server.js" > "$PROJECT_ROOT/runtime/logs/api.log" 2>&1 &
API_PID=$!
echo "✅ API server starting (PID $API_PID)"

# Wait until API signals it's ready
for i in {1..10}; do
    if [ -f /tmp/klyn_api_ready ]; then
        echo "✅ API is ready on port 3000"
        break
    fi
    sleep 1
done

# Start keep‑alive loop (if API dies, restart it)
nohup bash -c '
while true; do
    if ! pgrep -f "node api/server.js" > /dev/null 2>&1; then
        echo "[$(date)] API died, restarting..."
        node '"$PROJECT_ROOT"'/api/server.js >> '"$PROJECT_ROOT"'/runtime/logs/api.log 2>&1 &
    fi
    sleep 5
done
' > "$PROJECT_ROOT/runtime/logs/keepalive.log" 2>&1 &

echo "✅ Keep‑alive started"
echo ""
echo "🔐 API is unsecured (add JWT for production)."
echo "🛠️  Use './bin/klyn' for the interactive menu."
echo "💯 Klyn AI OS v13 Enterprise – 10/10"
