#!/data/data/com.termux/files/usr/bin/bash

echo "[GC] 🧹 KLYN OS System Garbage Collector"

# Remove empty generated scripts
find output -type f -size 0 -delete 2>/dev/null

# Remove duplicate snapshots older system clutter (safe simulation)
find snapshot -type f -name "*.sh" -mtime +2 -delete 2>/dev/null

# Limit runtime growth (prevent OS explosion)
find runtime -type f -name "*.tmp" -delete 2>/dev/null

echo "[GC] ✅ System cleaned and stabilized"
