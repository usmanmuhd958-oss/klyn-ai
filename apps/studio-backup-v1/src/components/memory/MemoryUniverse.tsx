"use client";

import {getMemoryGraph}
from "@/lib/memory/memoryEngine";


export default function MemoryUniverse(){

const graph=getMemoryGraph();


return (

<div className="absolute inset-0">

<div className="p-4 text-xs font-mono text-cyan-300">

KLYN Neural Memory Universe

</div>


{
graph.memories.map(memory=>(

<div
key={memory.id}
className="absolute rounded-full border border-purple-400/40 bg-black/60 px-3 py-2 text-xs"
style={{
left:memory.x,
top:memory.y
}}
>

{memory.label}

</div>

))

}

</div>

);

}
