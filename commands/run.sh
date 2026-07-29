#!/bin/bash
#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

mkdir -p runtime/pids
echo $$ > runtime/pids/klyn.pid

echo "[KLYN] Workspace running"
