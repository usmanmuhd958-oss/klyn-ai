#!/data/data/com.termux/files/usr/bin/bash

echo "=============================="
echo " KLYN MEMORY AUDIT"
echo "=============================="

echo "[1] Project:"
pwd

echo
echo "[2] Server:"
pgrep -af "klyn_server.js" || echo "Server offline"

echo
echo "[3] Vault:"
ls -lah vault_data 2>/dev/null || echo "vault_data missing"

echo
echo "[4] Memory functions:"
grep -n "storeMemory\|recall\|memoryMap" index.js

echo
echo "[5] Index engine:"
grep -n "indexCodebase\|readdirSync" klyn_server.js

echo
echo "=============================="
echo " Audit Complete"
echo "=============================="
