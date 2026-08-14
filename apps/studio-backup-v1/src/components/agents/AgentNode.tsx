"use client";

import React from "react";

export type AgentRole =
  | "planner"
  | "coder"
  | "reviewer"
  | "tester"
  | "deployer";

export type AgentStatus =
  | "idle"
  | "thinking"
  | "executing"
  | "completed"
  | "failed";


export interface AgentNodeData {

  id: string;

  role: AgentRole;

  status: AgentStatus;

  currentTask: string;

  confidence: number;

  memoryContext: string[];

}


interface AgentNodeProps {

  data: AgentNodeData;

}


const statusMap: Record<AgentStatus,string> = {

  idle: "IDLE",

  thinking: "THINKING",

  executing: "EXECUTING",

  completed: "COMPLETED",

  failed: "FAILED"

};


export default function AgentNode({
  data
}: AgentNodeProps) {


return (

<div
className="
w-72
rounded-xl
border
border-cyan-400/20
bg-[#1F2833]/80
backdrop-blur-md
p-4
text-[#C5C6C7]
shadow-lg
"
>


<div className="flex items-center justify-between">

<h3 className="text-cyan-300 font-semibold uppercase">

🤖 {data.role} Agent

</h3>


<span className="text-xs">

{statusMap[data.status]}

</span>


</div>



<div className="mt-4 text-sm">


<p>

Task:

</p>


<p className="text-white">

{data.currentTask}

</p>


</div>



<div className="mt-4">


<p className="text-xs">

Confidence

</p>


<div className="h-2 bg-black/40 rounded">

<div

className="
h-2
bg-cyan-400
rounded
"

style={{

width:`${data.confidence}%`

}}

/>

</div>


</div>



<div className="mt-4 text-xs">


Memory Events:

{data.memoryContext.length}


</div>



</div>

);


}
