#!/bin/bash

set -e

echo "Moving legacy executor"

mkdir -p archive-history/kernel-execution-backup


cp kernel/src/execution/agent_executor.ts \
archive-history/kernel-execution-backup/


echo "Creating compatibility bridge"

cat > kernel/src/execution/agent_executor.ts <<'EOF'

export {
 AgentExecutor
} from "@klyn/agent-runtime/executor";

EOF


echo "Agent executor ownership migrated"
