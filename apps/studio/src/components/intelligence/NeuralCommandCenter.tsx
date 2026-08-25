"use client";

import IntelligenceDashboard from "./IntelligenceDashboard";
import MissionPlanner from "./MissionPlanner";
import MemoryGraph from "./MemoryGraph";
import NeuralMetrics from "./NeuralMetrics";

export default function NeuralCommandCenter(){

return (

<div className="
grid
grid-cols-12
gap-6
">

<div className="
col-span-8
space-y-6
">

<IntelligenceDashboard />

<MissionPlanner />

</div>


<div className="
col-span-4
space-y-6
">

<NeuralMetrics />

<MemoryGraph />

</div>


</div>

);

}
