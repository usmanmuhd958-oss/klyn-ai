# KLYN AI OS Deployment Guide

1. Ensure all files are committed.
2. On Termux: `bash boot.sh`
3. Verify services: `pgrep -f evolution_engine.js && pgrep -f cognitive_router.js && pgrep -f llama_monitor.js`
4. Access dashboards: `http://localhost:8081`, `http://localhost:5000`
