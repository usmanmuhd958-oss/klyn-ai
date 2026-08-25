"use client";

const agents = [
  ["🧠 Architect Agent","Designing system architecture","98%"],
  ["⚛ Frontend Agent","Building interface layer","94%"],
  ["⚙ Backend Agent","Analyzing services","91%"],
  ["🛡 Security Agent","Checking vulnerabilities","97%"],
];

export default function AgentStatusCard(){

return (
<div className="
rounded-2xl
border border-white/10
bg-white/5
p-5
">

<h2 className="font-semibold">
Agent Intelligence
</h2>

<div className="mt-5 space-y-3">

{agents.map(([name,task,score])=>(
<div
key={name}
className="
rounded-xl
border border-white/10
p-4
"
>

<div className="flex justify-between">
<span>{name}</span>
<span className="text-green-400">
{score}
</span>
</div>

<p className="mt-2 text-xs text-gray-400">
{task}
</p>

<div className="mt-3 h-1 rounded bg-white/10">
<div
className="h-1 rounded bg-green-400"
style={{width:score}}
/>
</div>

</div>
))}

</div>

</div>
);

}
