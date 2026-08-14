#!/usr/bin/env bash
# KLYN OS — KIMI-3.16 Continuous Learning Loop
# Additive · Non-destructive · Termux compatible

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUDIO="$ROOT/apps/studio"

echo "=============================================="
echo " KLYN OS KIMI-3.16 CONTINUOUS LEARNING LOOP"
echo "=============================================="

mkdir -p \
"$STUDIO/src/components/learning" \
"$STUDIO/src/lib/learning"

echo "[KIMI-3.16] Creating learning contracts..."

cat <<'EOF' > "$STUDIO/src/components/learning/learning.types.ts"

export type LearningEventType =
 | "execution"
 | "failure"
 | "success"
 | "optimization";

export interface LearningEvent {
 id:string;
 agentId:string;
 type:LearningEventType;
 action:string;
 result:string;
 score:number;
 timestamp:number;
}

export interface AgentMemory {
 agentId:string;
 executions:number;
 successes:number;
 failures:number;
 intelligenceScore:number;
 lastImprovement:number;
}

EOF


echo "[KIMI-3.16] Creating Memory Intelligence Core..."

cat <<'EOF' > "$STUDIO/src/lib/learning/LearningEngine.ts"

import type { LearningEvent, AgentMemory } from "@/components/learning/learning.types";


const memory = new Map<string, AgentMemory>();


export function recordLearning(event:LearningEvent){

 const current =
 memory.get(event.agentId) ??
 {
  agentId:event.agentId,
  executions:0,
  successes:0,
  failures:0,
  intelligenceScore:0,
  lastImprovement:Date.now()
 };


 current.executions++;

 if(event.type==="success"){
   current.successes++;
 }

 if(event.type==="failure"){
   current.failures++;
 }


 current.intelligenceScore =
 Math.max(
 0,
 ((current.successes /
 current.executions) * 100)
 );


 current.lastImprovement = Date.now();


 memory.set(event.agentId,current);

 return current;

}



export function getAgentLearning(agentId:string){

 return memory.get(agentId);

}


export function getLearningMemory(){

 return Array.from(memory.values());

}

EOF


echo "[KIMI-3.16] Creating Learning Intelligence UI..."

cat <<'EOF' > "$STUDIO/src/components/learning/LearningDashboard.tsx"

"use client";

import {getLearningMemory}
from "@/lib/learning/LearningEngine";

export default function LearningDashboard(){

 const agents=getLearningMemory();


 return (

 <div className="glass-panel rounded-md p-3 font-mono">

 <div className="text-xs uppercase">
 continuous learning loop
 </div>


 {
 agents.map(agent=>(

 <div key={agent.agentId}
 className="mt-2 text-[10px]">

 {agent.agentId}

 <br/>

 intelligence:
 {agent.intelligenceScore.toFixed(2)}%

 </div>

 ))

 }


 {
 agents.length===0 &&
 <div className="text-[10px]">
 awaiting execution memory...
 </div>
 }


 </div>

 );

}

EOF



echo "[KIMI-3.16] Creating Learning Bridge..."

cat <<'EOF' > "$STUDIO/src/lib/learning/index.ts"

export *
from "./LearningEngine";

EOF



echo "=============================================="
echo " KIMI-3.16 COMPLETE"
echo " Continuous Learning Loop ONLINE"
echo "=============================================="

echo ""
echo "NEXT:"
echo "KIMI-3.17 Enterprise Collaboration"
