"use client";

const agents=[
"Architect",
"Frontend",
"Backend",
"Security",
"QA"
];

export default function AgentPulse(){

return (

<div className="
rounded-2xl
border border-white/10
bg-white/5
p-5
">

<h2 className="font-semibold">
Neural Agent Network
</h2>


<div className="
mt-5
space-y-3
">

{agents.map(agent=>(

<div
key={agent}
className="
flex
items-center
justify-between
rounded-xl
border
border-white/10
p-3
"
>

<span>
{agent} Agent
</span>

<span className="
h-2
w-2
rounded-full
bg-green-400
animate-pulse
"/>

</div>

))}

</div>

</div>

);

}
