"use client";


import {CodeNode} from "./code.types";


interface Props {
 node:CodeNode;
}


export default function CodeIntelligenceNode({node}:Props){


return (

<div
className="
rounded-xl
border
border-white/10
bg-[#1F2833]
p-5
text-white
backdrop-blur-md
"
>


<div className="font-bold">

{node.name}

</div>


<div className="text-xs opacity-60 mt-2">

{node.type}

</div>


<div className="text-xs mt-3">

Dependencies:
{node.dependencies.length}

</div>


</div>

);


}
