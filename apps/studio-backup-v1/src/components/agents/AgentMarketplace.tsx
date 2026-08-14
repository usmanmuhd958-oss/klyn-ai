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
