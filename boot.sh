#!/bin/bash
clear
echo "===================================="
echo "   KLYN-OS ENTERPRISE v2.0.0-KLYN"
echo "===================================="
node -e "import('./0.kernel/kernel.js').then(m=>new m.Kernel().boot())"
node -e "import('./4.mouth/cli.js').then(m=>new m.CLI().start())"
echo "[KLYN-OS] ONLINE. SYSTEM READY."
