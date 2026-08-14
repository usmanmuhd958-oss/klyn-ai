
"use client";

import type {
 ExecutionGraph
} from "./planner.types";


export default function ExecutionGraphView(
 {graph}:{graph:ExecutionGraph}
){

return (

<div className="glass-panel rounded-md p-4 font-mono">

<div className="text-xs uppercase tracking-widest text-accent">
Execution Graph
</div>


<div className="mt-3 space-y-2">

{graph.tasks.map(task=>(

<div
key={task.id}
className="border border-line rounded p-2"
>

<div className="text-xs text-ink">
{task.title}
</div>

<div className="text-[10px] text-ink-dim">
agent: {task.assignedAgent}
</div>

<div className="text-[10px] text-ink-dim">
risk: {task.risk}%
</div>


</div>

))}

</div>

</div>

)

}

