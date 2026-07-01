#!/data/data/com.termux/files/usr/bin/bash
source kernel/types.sh
source core/pipeline.sh

# Kashe tsofaffin daemons don tsaro
pkill -f "kernel/daemon.sh" 2>/dev/null

# Kunna Daemon tare da bin diddigin PID da Health
bash kernel/daemon.sh > /dev/null 2>&1 &
echo $! > runtime/daemon.pid

log "INFO" "Enterprise Kernel Booted Successfully."

# Idan mai amfani ya ba da umarni ta klyn.sh "build login system"
if [ ! -z "$1" ]; then
    run_pipeline "$1"
else
    echo "[KLYN OS V1.5] System Running. Pass an instruction to execute."
fi
