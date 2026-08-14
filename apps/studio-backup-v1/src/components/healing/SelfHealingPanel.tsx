"use client";

import {useState} from "react";

export default function SelfHealingPanel(){

const [status,setStatus]=useState(
"monitoring runtime"
);


return (

<div className="glass-panel rounded-md p-4 font-mono">

<div className="text-xs uppercase tracking-widest">
KLYN Self-Healing Runtime
</div>


<div className="mt-3 text-sm">
{status}
</div>


<button
className="mt-3 border px-3 py-1"
onClick={()=>
setStatus(
"failure detected → repair validated"
)}
>
Run Healing Cycle
</button>


</div>

);

}
