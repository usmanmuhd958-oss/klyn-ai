#!/usr/bin/env bash
# KLYN OS — KIMI-3.22 Spatial Intelligence Layer
# Additive · Non destructive · Termux compatible

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUDIO="$ROOT/apps/studio"

echo "=============================================="
echo " KLYN OS KIMI-3.22 SPATIAL INTELLIGENCE"
echo "=============================================="

mkdir -p \
"$STUDIO/src/types/spatial" \
"$STUDIO/src/lib/spatial" \
"$STUDIO/src/components/spatial"


echo "[KIMI-3.22] Creating spatial contracts..."

cat > "$STUDIO/src/types/spatial/spatial.types.ts" <<'EOF'
export interface SpatialNode {
 id:string;
 name:string;
 type:
 "file"|
 "agent"|
 "service"|
 "module";

 x:number;
 y:number;

 metadata?:Record<string,unknown>;
}


export interface SpatialConnection {
 source:string;
 target:string;
 relation:string;
}
EOF


echo "[KIMI-3.22] Creating Spatial Intelligence Core..."

cat > "$STUDIO/src/lib/spatial/spatialEngine.ts" <<'EOF'
import type {
 SpatialNode,
 SpatialConnection
} from "@/types/spatial/spatial.types";


const nodes:SpatialNode[]=[];

const connections:SpatialConnection[]=[];


export function registerNode(
node:SpatialNode
){

nodes.push(node);

}


export function connectNodes(
connection:SpatialConnection
){

connections.push(connection);

}


export function getSpatialMap(){

return {
nodes,
connections
};

}
EOF


echo "[KIMI-3.22] Creating Architecture Explorer UI..."

cat > "$STUDIO/src/components/spatial/SpatialExplorer.tsx" <<'EOF'
"use client";

import {getSpatialMap} from "@/lib/spatial/spatialEngine";


export default function SpatialExplorer(){

const map=getSpatialMap();


return (

<div className="absolute inset-0 overflow-hidden">

<div className="p-4 font-mono text-xs text-cyan-300">

KLYN Spatial Intelligence

</div>


{
map.nodes.map(node=>(

<div
key={node.id}
className="absolute rounded-lg border border-cyan-400/30 bg-black/50 px-3 py-2 text-xs"
style={{
left:node.x,
top:node.y
}}
>

{node.type}: {node.name}

</div>

))

}


</div>

)

}
EOF


echo "[KIMI-3.22] Creating Spatial Runtime Bridge..."

cat > "$STUDIO/src/lib/spatial/spatialBridge.ts" <<'EOF'
export function emitSpatialEvent(
type:string,
payload:unknown
){

return {
type,
payload,
timestamp:Date.now()
};

}
EOF


echo "=============================================="
echo " KIMI-3.22 COMPLETE"
echo " Spatial Intelligence Layer ONLINE"
echo "=============================================="

echo ""
echo "NEXT:"
echo "KIMI-3.23 Neural Memory Visualization"
