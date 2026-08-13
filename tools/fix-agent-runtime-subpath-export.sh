#!/usr/bin/env bash
set -e

echo "======================================"
echo " FIXING AGENT RUNTIME SUBPATH EXPORT"
echo "======================================"

PKG="packages/agent-runtime/package.json"

if [ ! -f "$PKG" ]; then
  echo "❌ Missing $PKG"
  exit 1
fi

node <<'NODE'
const fs = require("fs");

const file = "packages/agent-runtime/package.json";

const pkg = JSON.parse(fs.readFileSync(file,"utf8"));

pkg.exports = {
  ".": {
    "types": "./src/index.ts",
    "default": "./src/index.ts"
  },
  "./executor": {
    "types": "./src/executor/index.ts",
    "default": "./src/executor/index.ts"
  },
  "./runtime": {
    "types": "./src/runtime/AgentRuntime.ts",
    "default": "./src/runtime/AgentRuntime.ts"
  },
  "./memory": {
    "types": "./src/memory/SupabaseAgentMemory.ts",
    "default": "./src/memory/SupabaseAgentMemory.ts"
  }
};

fs.writeFileSync(
 file,
 JSON.stringify(pkg,null,2)+"\n"
);

console.log("✅ package exports updated");
NODE


echo ""
echo "Checking executor index..."

if [ ! -f packages/agent-runtime/src/executor/index.ts ]; then

cat > packages/agent-runtime/src/executor/index.ts <<'EOF'
export * from "./AgentExecutor.js";
