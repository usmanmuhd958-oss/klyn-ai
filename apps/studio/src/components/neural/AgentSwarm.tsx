"use client";

const agents = [
  {
    icon:"🧠",
    name:"Architect Agent",
    task:"Designing system architecture",
    memory:"12.4k decisions",
    confidence:"97%"
  },
  {
    icon:"⚛️",
    name:"Frontend Agent",
    task:"Building neural interfaces",
    memory:"8.9k components",
    confidence:"95%"
  },
  {
    icon:"⚙️",
    name:"Backend Agent",
    task:"Engineering distributed services",
    memory:"6.2k APIs",
    confidence:"96%"
  },
  {
    icon:"🛡️",
    name:"Security Guardian",
    task:"Scanning vulnerabilities",
    memory:"3.4k checks",
    confidence:"99%"
  },
  {
    icon:"🧪",
    name:"QA Agent",
    task:"Validating system quality",
    memory:"15k tests",
    confidence:"94%"
  }
];


export default function AgentSwarm(){

return (

<div className="
rounded-2xl
border border-white/10
bg-white/5
p-5
">

<h2 className="font-semibold">
Agent Civilization
</h2>

<p className="mt-1 text-xs text-gray-400">
Autonomous engineering workforce
</p>


<div className="mt-5 space-y-3">

{
agents.map(agent => (

<div
key={agent.name}
className="
rounded-xl
border border-white/10
bg-black/30
p-4
"
>

<div className="flex items-center justify-between">

<div className="font-medium">
{agent.icon} {agent.name}
</div>

<span className="text-xs text-green-400">
ONLINE
</span>

</div>


<div className="mt-3 text-xs text-gray-400">

<div>
Current Mission:
{agent.task}
</div>

<div className="mt-2">
Memory: {agent.memory}
</div>

<div className="mt-2 text-green-400">
Confidence {agent.confidence}
</div>

</div>


</div>

))

}

</div>

</div>

);

}
