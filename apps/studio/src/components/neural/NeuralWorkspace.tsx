"use client";

import NeuralHeader from "./NeuralHeader";
import CommandCenter from "./CommandCenter";
import AgentSwarm from "./AgentSwarm";
import ProjectBrain from "./ProjectBrain";
import ExecutionStream from "./ExecutionStream";

export default function NeuralWorkspace(){

return (
<div className="
min-h-screen
bg-black
text-white
p-6
space-y-6
">

<NeuralHeader />

<div className="
grid
grid-cols-[280px_1fr_320px]
gap-6
">

<div className="space-y-6">

<ProjectBrain />

<AgentSwarm />

</div>


<div className="space-y-6">

<CommandCenter />

<ExecutionStream />

</div>


<div className="
rounded-2xl
border
border-white/10
bg-white/5
p-6
">

<h2 className="font-bold">
KLYN Intelligence Core
</h2>

<p className="mt-4 text-sm text-gray-400">
Autonomous reasoning engine online.
</p>

</div>


</div>

</div>
);

}
