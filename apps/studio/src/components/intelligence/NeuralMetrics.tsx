"use client";

export default function NeuralMetrics(){

return (

<div className="
rounded-2xl
border border-white/10
bg-white/5
p-5
">

<h2 className="font-semibold">
Neural Metrics
</h2>

<div className="mt-5 grid grid-cols-2 gap-3">

<div className="rounded-xl border border-white/10 p-4">
<p className="text-xs text-gray-400">
Project Context
</p>
<p className="text-xl">
98%
</p>
</div>


<div className="rounded-xl border border-white/10 p-4">
<p className="text-xs text-gray-400">
Agent Velocity
</p>
<p className="text-xl">
12x
</p>
</div>


<div className="rounded-xl border border-white/10 p-4">
<p className="text-xs text-gray-400">
Risk Level
</p>
<p className="text-xl text-green-400">
Low
</p>
</div>


<div className="rounded-xl border border-white/10 p-4">
<p className="text-xs text-gray-400">
Coverage
</p>
<p className="text-xl">
96%
</p>
</div>

</div>

</div>

);

}
