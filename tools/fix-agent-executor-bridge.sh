#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "🔧 Fixing AgentExecutor compatibility bridge..."

FILE="kernel/src/execution/agent_executor.ts"

cat > "$FILE" <<'TS'

import {
  AgentExecutor
} from "@klyn/agent-runtime/executor";


let executorInstance: AgentExecutor | null = null;


export function getAgentExecutor(): AgentExecutor {

  if (!executorInstance) {
    executorInstance = new AgentExecutor();
  }

  return executorInstance;

}


export {
 AgentExecutor
};

TS


echo "✅ AgentExecutor bridge fixed"

