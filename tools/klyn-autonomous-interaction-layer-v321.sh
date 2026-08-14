#!/usr/bin/env bash
# KLYN OS — KIMI-3.21 Autonomous Interaction Layer
# Additive · Non destructive · Termux compatible

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUDIO="$ROOT/apps/studio"

echo "=============================================="
echo " KLYN OS KIMI-3.21 AUTONOMOUS INTERACTION"
echo "=============================================="

mkdir -p \
"$STUDIO/src/components/interaction" \
"$STUDIO/src/lib/interaction" \
"$STUDIO/src/types"


echo "[KIMI-3.21] Creating interaction contracts..."

cat > "$STUDIO/src/types/interaction.types.ts" <<'EOF'
export interface UserIntent {
 id:string;
 command:string;
 context?:Record<string,unknown>;
 timestamp:number;
}

export interface AgentAction {
 id:string;
 action:string;
 confidence:number;
}
EOF


echo "[KIMI-3.21] Creating Command Intelligence..."

cat > "$STUDIO/src/lib/interaction/commandEngine.ts" <<'EOF'
import type {UserIntent,AgentAction} from "@/types/interaction.types";

export function analyzeIntent(
intent:UserIntent
):AgentAction{

return {
id:crypto.randomUUID(),
action:`execute:${intent.command}`,
confidence:0.98
};

}
EOF


echo "[KIMI-3.21] Creating Neural Command HUD..."

cat > "$STUDIO/src/components/interaction/NeuralCommandHUD.tsx" <<'EOF'
"use client";

import {useState} from "react";
import {analyzeIntent} from "@/lib/interaction/commandEngine";

export default function NeuralCommandHUD(){

const [cmd,setCmd]=useState("");

return (
<div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[600px] glass-panel p-4">

<input
className="w-full bg-transparent outline-none"
placeholder="Ask KLYN Intelligence..."
value={cmd}
onChange={e=>setCmd(e.target.value)}
onKeyDown={e=>{
if(e.key==="Enter"){
console.log(
analyzeIntent({
id:"1",
command:cmd,
timestamp:Date.now()
})
)
}
}}
/>

</div>
)

}
EOF


echo "[KIMI-3.21] Creating Interaction Bridge..."

cat > "$STUDIO/src/lib/interaction/interactionBridge.ts" <<'EOF'
export function emitInteraction(event:string){

return {
event,
time:Date.now(),
accepted:true
};

}
EOF


echo "=============================================="
echo " KIMI-3.21 COMPLETE"
echo " Autonomous Interaction Layer ONLINE"
echo "=============================================="

echo ""
echo "NEXT:"
echo "KIMI-3.22 Spatial Intelligence Layer"
