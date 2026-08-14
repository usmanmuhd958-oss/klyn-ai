"use client";

import {useState} from "react";
import {analyzeIntent} from "@/lib/interaction/commandEngine";

export default function NeuralCommandHUD(){

const [cmd,setCmd]=useState("");

return (
<div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[600px] glass-panel p-4">

<input
className="w-full bg-transparent outline-none"
placeholder="Ask KLYN Intelligence..."
value={cmd}
onChange={e=>setCmd(e.target.value)}
onKeyDown={e=>{
if(e.key==="Enter"){
console.log(
analyzeIntent({
id:"1",
command:cmd,
timestamp:Date.now()
})
)
}
}}
/>

</div>
)

}
