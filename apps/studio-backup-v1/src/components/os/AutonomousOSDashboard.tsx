"use client";

import {
getCapabilities
} from "@/lib/os/autonomousRuntime";


export default function AutonomousOSDashboard(){

const modules=getCapabilities();


return (

<div className="glass-panel p-4 font-mono">

<div className="uppercase text-xs mb-3">
KLYN Autonomous Engineering OS
</div>


{modules.map(module=>(

<div
key={module.id}
className="flex justify-between text-[10px]"
>

<span>
{module.module}
</span>

<span className="text-accent">
{module.status}
</span>

</div>

))}


</div>

);

}
