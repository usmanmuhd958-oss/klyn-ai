"use client";

import React from "react";
import SwarmAgentNode from "./SwarmAgentNode";


export default function SwarmGraph(){


const agents=[

{

id:"planner",

name:"Planner Agent",

role:"System Architecture Planning",

status:"thinking" as const,

currentTask:"Analyzing engineering intent"

},

{

id:"coder",

name:"Coding Agent",

role:"Autonomous Implementation",

status:"executing" as const,

currentTask:"Modifying code entities"

},

{

id:"tester",

name:"Testing Agent",

role:"Validation Intelligence",

status:"idle" as const,

currentTask:"Waiting for execution"

}

];


return (

<div className="
flex
gap-6
p-10
">


{
agents.map(agent=>(

<SwarmAgentNode

key={agent.id}

agent={agent}

/>

))
}


</div>

);


}
