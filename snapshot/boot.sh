#!/data/data/com.termux/files/usr/bin/bash

echo "[KLYN OS] Booting autonomous system..."

mkdir -p runtime

# start daemon in background without messing up the screen
bash kernel/daemon.sh > /dev/null 2>&1 &
disown

echo "Daemon started successfully in stealth mode!"
