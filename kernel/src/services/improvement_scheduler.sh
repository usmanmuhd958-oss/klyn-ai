#!/bin/bash
PROJECT_ROOT="/data/data/com.termux/files/home/klyn-ai-os"
while true; do
  echo "🧬 Running autonomous self-improvement cycle..."
  node "$PROJECT_ROOT/kernel/src/services/autonomous_improver.js"
  echo "⏳ Next cycle in 6 hours..."
  sleep 21600  # 6 hours
done
