#!/data/data/com.termux/files/usr/bin/bash

echo "================================="
echo " KLYN ARCHITECTURE RISK ANALYZER"
echo "================================="

risk=0


echo "[1] Checking duplicate modules..."

duplicates=$(grep -R "class AgentRuntime\|class MemoryEngine\|class AIEngine" \
packages kernel intelligence core \
--include="*.ts" | wc -l)


if [ "$duplicates" -gt 5 ]; then
 echo "WARNING: duplicate architecture detected"
 risk=$((risk+30))
fi


echo "[2] Checking forbidden areas..."

if grep -R "2.vault" packages kernel intelligence core --include="*.ts"; then
 echo "Legacy dependency found"
 risk=$((risk+20))
fi


echo "[3] Checking archive imports..."

if grep -R "archive-history" packages kernel intelligence core --include="*.ts"; then
 echo "Archive dependency found"
 risk=$((risk+20))
fi


echo
echo "Architecture Risk Score: $risk/100"


if [ "$risk" -eq 0 ]; then
 echo "STATUS: ENTERPRISE CLEAN"
else
 echo "STATUS: REVIEW REQUIRED"
fi
