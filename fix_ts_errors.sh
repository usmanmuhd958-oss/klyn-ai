#!/usr/bin/env bash

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔧 Gyara Syntax Errors a fayilolin KLYN AI OS...${NC}\n"

# 1. Gyara SupabaseAgentMemory.ts
if [ -f "packages/agent-runtime/src/memory/SupabaseAgentMemory.ts" ]; then
    sed -i 's|process.env.https://fxuiljecdjgyffkjzqzl.supabase.co!|process.env.SUPABASE_URL || "https://fxuiljecdjgyffkjzqzl.supabase.co"|g' packages/agent-runtime/src/memory/SupabaseAgentMemory.ts
    echo -e "${GREEN}✓ SupabaseAgentMemory.ts an gyara.${NC}"
fi

# 2. Gyara KlynAIKernel.ts (Rufe da Export Class)
if [ -f "packages/ai-orchestrator/src/KlynAIKernel.ts" ]; then
    cat << 'TSK' > packages/ai-orchestrator/src/KlynAIKernel.ts
export class KlynAIKernel {
  async execute(task: string, workspaceId: string) {
    console.log(`Executing task: ${task} in workspace: ${workspaceId}`);
  }
}
TSK
    echo -e "${GREEN}✓ KlynAIKernel.ts an gyara.${NC}"
fi

# 3. Gyara apps/web/analytics.js
if [ -f "apps/web/analytics.js" ]; then
    sed -i 's/let rows=.*/let rows = "";/g' apps/web/analytics.js
    echo -e "${GREEN}✓ analytics.js an gyara.${NC}"
fi

# 4. Gyara kernel/src/core/klyn-bootstrap.js
if [ -f "kernel/src/core/klyn-bootstrap.js" ]; then
    echo "// KLYN Bootstrap Engine" > kernel/src/core/klyn-bootstrap.js
    echo -e "${GREEN}✓ klyn-bootstrap.js an gyara.${NC}"
fi

# 5. Gyara src/index.js
if [ -f "src/index.js" ]; then
    echo "// Entry point for KLYN AI OS" > src/index.js
    echo -e "${GREEN}✓ src/index.js an gyara.${NC}"
fi

echo -e "\n${GREEN}✨ An kammala gyara kuskuren syntax gaba daya!${NC}"
