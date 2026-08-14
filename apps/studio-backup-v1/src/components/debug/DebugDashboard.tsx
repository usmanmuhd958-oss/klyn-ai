"use client";

import {
getDebugHistory
}
from "@/lib/debug/debugEngine";


export default function DebugDashboard(){

const events=getDebugHistory();


return (

<div className="absolute inset-0 p-6">

<div className="font-mono text-xs text-red-300">

KLYN Debug Intelligence

</div>


{
events.map(event=>(

<div
key={event.id}
className="mt-2 rounded-lg border border-red-400/30 bg-black/40 p-3 text-xs"
>

{event.severity}: {event.error}

</div>

))

}

</div>

);

}
