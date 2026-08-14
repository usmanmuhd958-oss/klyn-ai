"use client";

export default function ExecutionTimeline(){

const events=[
"Intent received",
"Planner generated graph",
"Agent execution started",
"Validation running"
];

return (

<div className="absolute bottom-6 left-1/2 z-20 w-[90%] max-w-[600px] -translate-x-1/2 rounded-xl border border-cyan-400/20 bg-black/50 p-4 backdrop-blur-xl font-mono">

<div className="mb-3 text-xs uppercase tracking-widest text-cyan-300">
Execution Timeline
</div>

{
events.map((e,i)=>(
<div key={i} className="text-[11px] text-gray-300">
<span className="text-cyan-300">
●
</span>
{" "}
{e}
</div>
))
}

</div>

)

}
