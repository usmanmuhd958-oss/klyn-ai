#!/usr/bin/env bash
set -e

echo "======================================"
echo " FIX AGENT RUNTIME EXECUTOR SUBPATH"
echo "======================================"


node <<'NODE'
const fs=require("fs");

const file="tsconfig.json";

const ts=JSON.parse(fs.readFileSync(file,"utf8"));

ts.compilerOptions.baseUrl=".";

ts.compilerOptions.paths={
 ...(ts.compilerOptions.paths || {}),

 "@klyn/agent-runtime": [
   "packages/agent-runtime/src/index.ts"
 ],

 "@klyn/agent-runtime/executor": [
   "packages/agent-runtime/src/executor/index.ts"
 ],

 "@klyn/agent-runtime/*": [
   "packages/agent-runtime/src/*"
 ]
};


fs.writeFileSync(
 file,
 JSON.stringify(ts,null,2)+"\n"
);

console.log("✅ executor subpath mapped");
NODE


echo ""
echo "[VERIFY]"

cat packages/agent-runtime/src/executor/index.ts


echo ""
echo "[TYPECHECK]"

npm run typecheck


echo ""
echo "======================================"
echo " EXECUTOR SUBPATH FIX COMPLETE"
echo "======================================"
