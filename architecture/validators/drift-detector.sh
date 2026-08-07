#!/data/data/com.termux/files/usr/bin/bash

set -e


echo "[DRIFT CHECK]"


if grep -R "class AgentRuntime" \
--include="*.ts" \
packages kernel intelligence core agents \
| grep -v "packages/agent-runtime/src/runtime/AgentRuntime.ts"; then

echo "AgentRuntime duplicate detected"
exit 1

fi


if grep -R "class MemoryEngine" \
--include="*.ts" \
packages kernel intelligence core agents \
| grep -v "intelligence/memory/MemoryEngine.ts"; then

echo "MemoryEngine duplicate detected"
exit 1

fi


echo "NO ARCHITECTURE DRIFT"
