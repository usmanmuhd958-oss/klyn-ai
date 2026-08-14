"use client";

import React from "react";
import AgentSwarmGraph from "../agents/AgentSwarmGraph";


export default function SpatialUniverse() {


return (

<div
className="relative h-screen w-screen overflow-hidden bg-[#0B0C10] text-[#C5C6C7]"
>


{/* Cognitive Grid */}

<div
className="absolute inset-0 opacity-30 bg-[radial-gradient(#45A29E_1px,transparent_1px)] [background-size:24px_24px]"
/>



{/* Intelligence Canvas */}

<div
className="absolute inset-0"
>

<AgentSwarmGraph />

</div>



{/* Command HUD */}

<div
className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[600px] rounded-xl border border-cyan-400/20 bg-black/40 backdrop-blur-xl px-6 py-4"
>

<span className="text-cyan-300">

⌘K

</span>


<span className="ml-3">

Summon KLYN Intelligence

</span>


</div>



</div>

);


}
