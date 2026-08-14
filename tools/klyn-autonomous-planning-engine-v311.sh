#!/usr/bin/env bash
# tools/klyn-autonomous-planning-engine-v311.sh
# KLYN OS — KIMI-3.11 Autonomous Planning Engine
# Additive · Non-destructive · Termux compatible

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUDIO="$ROOT/apps/studio"

echo "=============================================="
echo " KLYN OS KIMI-3.11 AUTONOMOUS PLANNING ENGINE"
echo "=============================================="

if [ ! -d "$STUDIO" ]; then
  echo "ERROR: apps/studio missing"
  exit 1
fi

mkdir -p \
"$STUDIO/src/components/planner" \
"$STUDIO/src/lib/planning"

echo "[KIMI-3.11] Creating planner contracts..."

cat <<'EOF' > "$STUDIO/src/components/planner/planner.types.ts"
export type PlanningStatus =
  | "pending"
  | "analyzing"
  | "assigned"
  | "executing"
  | "completed"
  | "failed";

export type AgentRole =
  | "planner"
  | "architect"
  | "coder"
  | "tester"
  | "security"
  | "deployment";

export interface PlanningTask {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  assignedAgent?: AgentRole;
  status: PlanningStatus;
  risk: number;
}

export interface ExecutionGraph {
  id: string;
  intent: string;
  tasks: PlanningTask[];
  createdAt: number;
}
EOF


echo "[KIMI-3.11] Creating Planning Intelligence Core..."

cat <<'EOF' > "$STUDIO/src/lib/planning/PlanningEngine.ts"

import type {
  ExecutionGraph,
  PlanningTask,
  AgentRole,
} from "@/components/planner/planner.types";


function id(prefix:string){
 return `${prefix}-${Date.now()}-${Math.random()
 .toString(36)
 .slice(2,8)}`;
}


export class PlanningEngine {

  createPlan(intent:string):ExecutionGraph {

    const tasks:PlanningTask[]=[
      {
        id:id("task"),
        title:"Analyze requirement",
        description:intent,
        dependencies:[],
        assignedAgent:"planner",
        status:"analyzing",
        risk:10
      },
      {
        id:id("task"),
        title:"Design architecture",
        description:"Generate system architecture",
        dependencies:[],
        assignedAgent:"architect",
        status:"pending",
        risk:25
      },
      {
        id:id("task"),
        title:"Implementation",
        description:"Generate production code",
        dependencies:[],
        assignedAgent:"coder",
        status:"pending",
        risk:40
      },
      {
        id:id("task"),
        title:"Validation",
        description:"Run tests and verification",
        dependencies:[],
        assignedAgent:"tester",
        status:"pending",
        risk:20
      }
    ];


    return {
      id:id("plan"),
      intent,
      tasks,
      createdAt:Date.now()
    };

  }


  assignAgent(task:PlanningTask):AgentRole{

    if(task.assignedAgent)
      return task.assignedAgent;

    return "coder";

  }

}

EOF


echo "[KIMI-3.11] Creating Execution Graph UI..."

cat <<'EOF' > "$STUDIO/src/components/planner/ExecutionGraph.tsx"

"use client";

import type {
 ExecutionGraph
} from "./planner.types";


export default function ExecutionGraphView(
 {graph}:{graph:ExecutionGraph}
){

return (

<div className="glass-panel rounded-md p-4 font-mono">

<div className="text-xs uppercase tracking-widest text-accent">
Execution Graph
</div>


<div className="mt-3 space-y-2">

{graph.tasks.map(task=>(

<div
key={task.id}
className="border border-line rounded p-2"
>

<div className="text-xs text-ink">
{task.title}
</div>

<div className="text-[10px] text-ink-dim">
agent: {task.assignedAgent}
</div>

<div className="text-[10px] text-ink-dim">
risk: {task.risk}%
</div>


</div>

))}

</div>

</div>

)

}

EOF


echo "[KIMI-3.11] Creating Planner Canvas..."

cat <<'EOF' > "$STUDIO/src/components/planner/PlannerCanvas.tsx"

"use client";

import {useState} from "react";
import {PlanningEngine} from "@/lib/planning/PlanningEngine";
import ExecutionGraphView from "./ExecutionGraph";


const engine=new PlanningEngine();


export default function PlannerCanvas(){

const [intent,setIntent]=useState("");
const [graph,setGraph]=useState<any>(null);


return (

<div className="glass-panel p-4 rounded-md font-mono">

<input
className="w-full bg-transparent border border-line p-2 text-sm"
placeholder="Describe your engineering goal..."
value={intent}
onChange={e=>setIntent(e.target.value)}
/>


<button
className="mt-3 border border-accent px-3 py-1 text-accent"
onClick={()=>{
 setGraph(
 engine.createPlan(intent)
 )
}}
>
Generate Plan
</button>


{graph &&
<ExecutionGraphView graph={graph}/>
}


</div>

)

}

EOF


echo "=============================================="
echo " KIMI-3.11 COMPLETE"
echo " Autonomous Planning Engine ONLINE"
echo "=============================================="
