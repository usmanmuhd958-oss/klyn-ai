"use client";

import {getSpatialMap} from "@/lib/spatial/spatialEngine";


export default function SpatialExplorer(){

const map=getSpatialMap();


return (

<div className="absolute inset-0 overflow-hidden">

<div className="p-4 font-mono text-xs text-cyan-300">

KLYN Spatial Intelligence

</div>


{
map.nodes.map(node=>(

<div
key={node.id}
className="absolute rounded-lg border border-cyan-400/30 bg-black/50 px-3 py-2 text-xs"
style={{
left:node.x,
top:node.y
}}
>

{node.type}: {node.name}

</div>

))

}


</div>

)

}
