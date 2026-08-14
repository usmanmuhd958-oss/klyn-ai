"use client";

import React from "react";


export interface SwarmAgent {

 id:string;

 name:string;

 role:string;

 status:
 "idle" |
 "thinking" |
 "executing" |
 "complete";


 currentTask:string;

}


interface Props {

 agent:SwarmAgent;

}



export default function SwarmAgentNode({
 agent
}:Props){


const statusColor = {

idle:"text-gray-400",

thinking:"text-yellow-300",

executing:"text-cyan-300",

complete:"text-green-300"

}[agent.status];


return (

<div

className="
w-72
rounded-xl
border
border-cyan-400/20
bg-[#1F2833]/80
backdrop-blur-md
p-5
shadow-xl
"

>


<div className="flex justify-between">


<h3 className="
font-bold
text-white
">

🤖 {agent.name}

</h3>


<span className={statusColor}>

{agent.status}

</span>


</div>



<p className="text-sm mt-3 text-gray-300">

{agent.role}

</p>



<div className="
mt-4
text-xs
text-cyan-200
">

TASK:

{agent.currentTask}

</div>


</div>

);


}
