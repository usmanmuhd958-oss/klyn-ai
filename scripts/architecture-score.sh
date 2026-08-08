#!/data/data/com.termux/files/usr/bin/bash

echo "==============================="
echo " KLYN ARCHITECTURE SCORE"
echo "==============================="


score=100


if grep -R "2.vault" packages kernel intelligence core agents --include="*.ts"; then
score=$((score-20))
fi


if grep -R "archive-history" packages kernel intelligence core agents --include="*.ts"; then
score=$((score-20))
fi


duplicates=$(grep -R "class AgentRuntime\|class AIEngine\|class MemoryEngine" \
packages kernel intelligence core --include="*.ts" | wc -l)


if [ "$duplicates" -gt 5 ]; then
score=$((score-20))
fi


echo "Architecture Health: $score/100"
