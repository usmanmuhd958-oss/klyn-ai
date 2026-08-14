"use client";

export default function NeuralHUD(){

return (
<div className="pointer-events-none absolute top-4 left-4 z-20 w-[280px] rounded-xl border border-cyan-400/20 bg-black/40 p-4 backdrop-blur-xl font-mono">

<div className="text-xs uppercase tracking-[0.3em] text-cyan-300">
KLYN Intelligence
</div>

<div className="mt-3 space-y-2 text-[11px] text-gray-300">

<div>
🧠 Reasoning Engine
<span className="float-right text-green-400">
ONLINE
</span>
</div>

<div>
🤖 Agents
<span className="float-right">
ACTIVE
</span>
</div>

<div>
⚡ Runtime
<span className="float-right text-cyan-300">
412 t/s
</span>
</div>

<div>
🧬 Learning
<span className="float-right text-green-400">
SYNC
</span>
</div>

</div>

</div>
)

}
