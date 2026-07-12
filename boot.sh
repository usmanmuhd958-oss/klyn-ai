#!/bin/bash
export PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p runtime/{logs,events,pids,metrics}

echo "👑 Klyn AI OS v23 – Enterprise Final"
echo "===================================="

# Core API (must start first)
node api/server.js > runtime/logs/api.log 2>&1 &
echo "✅ API Server (PID $!)"
sleep 1

# Metrics
node api/metrics.js > runtime/logs/metrics.log 2>&1 &
echo "✅ Metrics (PID $!)"

# Admin Dashboard
node apps/web/admin.js > runtime/logs/admin.log 2>&1 &
echo "✅ Admin Dashboard (port 5000)"

# Web Editor
node dashboard/web_editor.js > runtime/logs/web_editor.log 2>&1 &
echo "✅ Web Editor (port 8081)"

# Gateway
node api/gateway.js > runtime/logs/gateway.log 2>&1 &
echo "✅ Gateway (port 8000)"

# Collaboration Server
node services/collaboration/server.js > runtime/logs/collaboration.log 2>&1 &
echo "✅ Collaboration (port 9000)"

# System Monitor
bash agents/src/sys_monitor.sh > runtime/logs/sys_monitor.log 2>&1 &
echo "✅ System Monitor"

# Crash Recovery Daemon
bash kernel/src/services/crash_recovery.sh > runtime/logs/crash_recovery.log 2>&1 &
echo "✅ Crash Recovery (auto‑restarts dead services)"

# Plugin auto‑install
bash plugins/auto_install.sh &
echo "✅ Plugins loaded"

# Autonomous Improvement Scheduler (every 6 hours)
nohup bash -c 'while true; do bash agents/src/autonomous_improver.sh; sleep 21600; done' > runtime/logs/autonomous_improver.log 2>&1 &
echo "✅ Autonomous Improvement (every 6h)"

# Backup rotation (daily)
nohup bash -c 'while true; do bash scripts/backup_rotate.sh; sleep 86400; done' > runtime/logs/backup.log 2>&1 &
echo "✅ Daily Backup Rotation"

# Status page
node apps/web/status.js > runtime/logs/status_page.log 2>&1 &
echo "✅ System Status Page (port 5050)"
# Performance Analytics (port 6060)
nohup node apps/web/analytics.js > runtime/logs/analytics.log 2>&1 &
echo "✅ Performance Analytics (port 6060)"

echo ""
echo "🔐 API: http://localhost:3000/status"
echo "🏛️ Admin: http://localhost:5000"
echo "🌐 Web IDE: http://localhost:8081"
echo "📊 Status: http://localhost:5050"
echo "🧩 CLI: ./bin/supashell"
echo "💯 Klyn AI OS v23 – Enterprise, 10/10, sovereign and self‑maintaining"
