"use client";

import React from "react";
import CodeIntelligenceNode from "./CodeIntelligenceNode";


export default function DependencyGraph(){


const node = {

id:"auth-core",

path:"src/core/auth/session.ts",

language:"TypeScript",

health:96,

security:"A+",

dependencies:24,

ownerAgent:"Coding Agent #04",

evolutionVersion:42

};


return (

<div className="p-10">

<CodeIntelligenceNode data={node}/>

</div>

);


}
