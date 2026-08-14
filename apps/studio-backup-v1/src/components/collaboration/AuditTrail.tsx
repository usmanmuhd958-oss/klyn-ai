"use client";

import {
 getAuditTrail
} from "@/lib/collaboration/workspaceSync";


export default function AuditTrail(){

const logs=getAuditTrail();


return (

<div className="glass-panel p-3 font-mono">

<div className="uppercase text-xs">
Audit Trail
</div>


{logs.map(log=>(

<div
key={log.id}
className="text-[10px]"
>
{log.actor} → {log.action}

</div>

))}


</div>

);

}
