#!/bin/bash
while true; do
  DISK_USAGE=$(df /data | awk 'NR==2 {print $5}' | sed 's/%//')
  MEM_FREE=$(free -m | awk '/Mem:/ {print $4}')
  if [ "$DISK_USAGE" -gt 90 ]; then
    echo "[$(date)] Disk usage critical ($DISK_USAGE%), cleaning logs..." >> runtime/logs/sys_monitor.log
    find runtime/logs -name "*.log" -mtime +7 -delete
  fi
  if [ "$MEM_FREE" -lt 100 ]; then
    echo "[$(date)] Low memory (${MEM_FREE}MB), restarting heavy services..." >> runtime/logs/sys_monitor.log
    pkill -f "node dashboard/web_editor.js" 2>/dev/null || true
    sleep 2
    nohup node dashboard/web_editor.js > runtime/logs/web_editor.log 2>&1 &
  fi
  sleep 300  # check every 5 minutes
done
