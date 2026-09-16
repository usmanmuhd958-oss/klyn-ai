#!/data/data/com.termux/files/usr/bin/bash

echo "================================="
echo " KLYN MODULE OWNERSHIP CHECK"
echo "================================="

fail=0


declare -A modules

modules["AgentRuntime"]="packages/agent-runtime"
modules["AgentExecutor"]="packages/agent-runtime"
modules["AIEngine"]="packages/ai-gateway"
modules["WorkflowEngine"]="packages/workflow-engine"
modules["MemoryEngine"]="intelligence"


for module in "${!modules[@]}"
do

path=${modules[$module]}

count=$(grep -R "class $module" \
"$path" \
--include="*.ts" | wc -l)


if [ "$count" -ne 1 ]; then
 echo "ERROR: $module ownership invalid"
 fail=1
else
 echo "OK: $module"
fi

done


if [ "$fail" -eq 0 ]; then
 echo "OWNERSHIP VALID"
else
 echo "OWNERSHIP FAILURE"
fi
