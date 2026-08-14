"use client";

import React from "react";
import {useAgentStream} from "./useAgentStream";


export default function AgentEventStream(){


const {events}=useAgentStream();


return (

<div
className="
fixed
right-6
top-6
w-96
rounded-xl
border
border-cyan-400/20
bg-black/50
backdrop-blur-xl
p-4
"
>


<h2 className="
text-cyan-300
font-bold
mb-3
">

⚡ Agent Neural Stream

</h2>


{
events.map(event=>(

<div
key={event.id}
className="text-sm text-gray-300 mb-2"
>

[{event.type}]
&nbsp;
{event.message}

</div>

))
}


</div>

);

}
