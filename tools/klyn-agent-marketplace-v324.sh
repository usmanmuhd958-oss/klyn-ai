#!/usr/bin/env bash
# KLYN OS — KIMI-3.24 Agent Marketplace Layer
# Additive · Non destructive · Termux compatible

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUDIO="$ROOT/apps/studio"

echo "=============================================="
echo " KLYN OS KIMI-3.24 AGENT MARKETPLACE"
echo "=============================================="

mkdir -p \
"$STUDIO/src/types/agents" \
"$STUDIO/src/lib/agents" \
"$STUDIO/src/components/agents"


echo "[KIMI-3.24] Creating agent contracts..."

cat > "$STUDIO/src/types/agents/agent.types.ts" <<'EOF'
export interface MarketplaceAgent {

id:string;

name:string;

category:
"coding"|
"testing"|
"deployment"|
"analysis";

capabilities:string[];

version:string;

status:
"installed"|
"available";

}
EOF


echo "[KIMI-3.24] Creating Agent Registry Core..."

cat > "$STUDIO/src/lib/agents/agentRegistry.ts" <<'EOF'
import type {
MarketplaceAgent
} from "@/types/agents/agent.types";


const agents:MarketplaceAgent[]=[];


export function registerAgent(
agent:MarketplaceAgent
){

agents.push(agent);

}


export function discoverAgents(
capability:string
){

return agents.filter(agent =>
agent.capabilities.includes(capability)
);

}


export function getAgents(){

return agents;

}
EOF


echo "[KIMI-3.24] Creating Agent Marketplace UI..."

cat > "$STUDIO/src/components/agents/AgentMarketplace.tsx" <<'EOF'
"use client";

import {getAgents}
from "@/lib/agents/agentRegistry";


export default function AgentMarketplace(){

const agents=getAgents();


return (

<div className="absolute inset-0 p-6">

<h2 className="text-cyan-300 font-mono text-sm">
KLYN Agent Marketplace
</h2>


<div className="grid grid-cols-3 gap-3 mt-4">

{
agents.map(agent=>(

<div
key={agent.id}
className="rounded-xl border border-cyan-400/30 bg-black/40 p-4 text-xs"
>

<div>{agent.name}</div>

<div>{agent.category}</div>

<div>{agent.version}</div>

</div>

))
}

</div>

</div>

);

}
EOF


echo "[KIMI-3.24] Creating Agent Runtime Bridge..."

cat > "$STUDIO/src/lib/agents/agentBridge.ts" <<'EOF'
export function installAgent(
agentId:string
){

return {

installed:true,

agentId,

timestamp:Date.now()

};

}
EOF


echo "=============================================="
echo " KIMI-3.24 COMPLETE"
echo " Agent Marketplace ONLINE"
echo "=============================================="

echo ""
echo "NEXT:"
echo "KIMI-3.25 Autonomous Debugging Intelligence"
