
"use client";

import {useState} from "react";
import {PlanningEngine} from "@/lib/planning/PlanningEngine";
import ExecutionGraphView from "./ExecutionGraph";


const engine=new PlanningEngine();


export default function PlannerCanvas(){

const [intent,setIntent]=useState("");
const [graph,setGraph]=useState<any>(null);


return (

<div className="glass-panel p-4 rounded-md font-mono">

<input
className="w-full bg-transparent border border-line p-2 text-sm"
placeholder="Describe your engineering goal..."
value={intent}
onChange={e=>setIntent(e.target.value)}
/>


<button
className="mt-3 border border-accent px-3 py-1 text-accent"
onClick={()=>{
 setGraph(
 engine.createPlan(intent)
 )
}}
>
Generate Plan
</button>


{graph &&
<ExecutionGraphView graph={graph}/>
}


</div>

)

}

