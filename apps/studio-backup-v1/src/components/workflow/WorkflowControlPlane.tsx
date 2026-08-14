"use client";

import { useState } from "react";
import {
  createWorkflow,
  advanceWorkflow,
} from "@/lib/workflow/autonomousWorkflowEngine";

export default function WorkflowControlPlane(){

const [graph,setGraph]=useState<any>(null);

function start(){
 setGraph(
   createWorkflow(
    "Autonomous software engineering task"
   )
 );
}

function execute(){
 if(graph){
  setGraph(
   advanceWorkflow(graph)
  );
 }
}

return (
<div className="glass-panel p-4 font-mono">

<h2 className="text-xs uppercase">
KLYN Autonomous Workflow Engine
</h2>

<button
className="border p-2 m-2"
onClick={start}>
PLAN
</button>

<button
className="border p-2 m-2"
onClick={execute}>
EXECUTE
</button>

<pre className="text-xs">
{JSON.stringify(graph,null,2)}
</pre>

</div>
)

}
