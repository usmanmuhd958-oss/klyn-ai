#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "🔧 Fixing agent-runtime exports"


mkdir -p packages/agent-runtime/src/executor


cat > packages/agent-runtime/src/executor/index.ts <<'TS'

export {
 AgentExecutor
} from "./AgentExecutor.js";

TS


node - <<'NODE'

const fs=require("fs");

let file=
"packages/agent-runtime/src/index.ts";

let data=
fs.readFileSync(file,"utf8");


if(!data.includes("executor/index"))
{
 data +=
 '\nexport * from "./executor/index.js";\n';
}


fs.writeFileSync(file,data);

NODE


echo "✅ agent-runtime exports repaired"

