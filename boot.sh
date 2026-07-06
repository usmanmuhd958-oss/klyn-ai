#!/bin/bash
export PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p runtime/{logs,events,queue/failed,pids,metrics}

echo "🚀 Klyn AI OS v11 Enterprise"
echo "============================"

# Start supervisor (which starts everything else)
# Launch self‑improvement cycle on boot
nohup bash agents/src/self_improver.sh > runtime/logs/self_improver.log 2>&1 &
nohup bash kernel/src/core/supervisor.sh > runtime/logs/supervisor.log 2>&1 &
echo "✅ Supervisor started (PID $!)"

echo ""
echo "🔐 API secured with JWT. Default login: admin / klyn"
echo "   Change via ADMIN_PASSWORD env var."
echo ""
echo "🛠️  Use './bin/klyn' for the interactive menu."
echo "💯 Klyn AI OS is now fully enterprise-grade."
