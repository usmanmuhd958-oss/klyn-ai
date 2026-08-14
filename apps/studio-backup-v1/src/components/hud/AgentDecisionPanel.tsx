"use client";

import { AgentAction } from "./command.types";


export default function AgentDecisionPanel(){

const agents:AgentAction[]=[

{
agentId:"planner",
role:"planner",
action:"Analyzing intent",
status:"thinking"
},

{
agentId:"coder",
role:"coder",
action:"Preparing implementation",
status:"waiting"
},

{
agentId:"tester",
role:"tester",
action:"Waiting validation",
status:"waiting"
}

];


return (

<div className="
space-y-3
">

{
agents.map(agent=>(

<div
key={agent.agentId}
className="
rounded-xl
border
border-white/10
bg-white/5
p-4
text-white
backdrop-blur-md
"
>

<div className="font-bold">
{agent.role.toUpperCase()}
</div>


<div className="text-sm opacity-70">
{agent.action}
</div>


<div className="text-xs mt-2">
{agent.status}
</div>


</div>

))
}

</div>

);


}
