
"use client";


import {
 useState
} from "react";


import {
 agentRegistry
} from "@/lib/agents/AgentRegistry";


const DEFAULT_AGENTS=[

{
id:"planner-01",
role:"planner",
capability:[
"task decomposition",
"execution planning"
]
},

{
id:"architect-01",
role:"architect",
capability:[
"system design",
"dependency analysis"
]
},

{
id:"coder-01",
role:"coder",
capability:[
"typescript",
"implementation"
]
},

{
id:"tester-01",
role:"tester",
capability:[
"testing",
"validation"
]
},

{
id:"security-01",
role:"security",
capability:[
"security scanning"
]
}

];


DEFAULT_AGENTS.forEach(
agent =>
agentRegistry.register(agent as any)
);



export default function AgentSwarmRuntime(){

const [agents]=useState(
 agentRegistry.list()
);


return (

<div className="glass-panel p-3 font-mono">

<div className="text-[10px] uppercase tracking-widest">
KLYN Agent Swarm Runtime
</div>


<div className="mt-3 space-y-2">

{
agents.map(agent=>(

<div
key={agent.id}
className="border border-line p-2"
>

<div className="text-accent text-xs">
{agent.id}
</div>

<div className="text-[9px]">
ROLE: {agent.role}
</div>


<div className="text-[9px] text-ink-dim">

CAPABILITIES:

{agent.capability.join(", ")}

</div>


</div>

))
}

</div>

</div>

)

}

