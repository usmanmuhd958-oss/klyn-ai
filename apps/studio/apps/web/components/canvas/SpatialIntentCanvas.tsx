"use client";

import {
 ReactFlow,
 Background,
 Controls,
 type Node,
 type Edge
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

const nodes:Node[]=[
 {
 id:"intent",
 position:{x:0,y:100},
 data:{label:"Intent Node\nBuild SaaS Platform"},
 className:"glass text-purple-300"
 },
 {
 id:"api",
 position:{x:250,y:100},
 data:{label:"Architecture API"},
 className:"glass text-cyan-300"
 },
 {
 id:"ast",
 position:{x:500,y:100},
 data:{label:"AST Symbol Graph"},
 className:"glass text-emerald-300"
 },
 {
 id:"guard",
 position:{x:750,y:100},
 data:{label:"Runtime Guard"},
 className:"glass text-amber-300"
 }
];

const edges:Edge[]=[
 {id:"a",source:"intent",target:"api"},
 {id:"b",source:"api",target:"ast"},
 {id:"c",source:"ast",target:"guard"}
];

export default function SpatialIntentCanvas(){

return (
<div className="h-full w-full">
<ReactFlow
nodes={nodes}
edges={edges}
fitView
>
<Background/>
<Controls/>
</ReactFlow>
</div>
);
}
