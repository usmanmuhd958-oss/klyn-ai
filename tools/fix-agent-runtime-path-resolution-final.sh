#!/usr/bin/env bash
set -e

echo "======================================"
echo " FIX AGENT RUNTIME PATH RESOLUTION"
echo "======================================"

echo "[1] Backup tsconfig"

cp tsconfig.json "tsconfig.json.backup.$(date +%s)"


echo "[2] Updating tsconfig paths"

node <<'NODE'
const fs=require("fs");

const file="tsconfig.json";

const json=JSON.parse(
 fs.readFileSync(file,"utf8")
);

json.compilerOptions ??= {};

json.compilerOptions.baseUrl=".";

json.compilerOptions.paths={
 ...(json.compilerOptions.paths || {}),

 "@klyn/agent-runtime":[
   "packages/agent-runtime/src/index.ts"
 ],

 "@klyn/agent-runtime/*":[
   "packages/agent-runtime/src/*"
 ]
};


fs.writeFileSync(
 file,
 JSON.stringify(json,null,2)+"\n"
);

console.log("✅ tsconfig paths fixed");
NODE


echo "[3] Checking executor exports"


if ! grep -q "AgentExecutor" packages/agent-runtime/src/executor/index.ts
then

cat > packages/agent-runtime/src/executor/index.ts <<'EXPORT'
export {
  AgentExecutor
} from "./AgentExecutor.js";

export {
  AgentExecutor as default
} from "./AgentExecutor.js";
EXPORT

fi


echo "[4] Running typecheck"

npm run typecheck


echo ""
echo "======================================"
echo " AGENT RUNTIME PATH FIX COMPLETE"
echo "======================================"
