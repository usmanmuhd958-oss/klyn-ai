"use client";

import NeuralHUD from "../intelligence/NeuralHUD";
import ExecutionTimeline from "../intelligence/ExecutionTimeline";

export default function KlynShell({
children
}:{
children:React.ReactNode
}){

return (

<div className="relative h-screen w-screen overflow-hidden bg-[#05070A] text-white">

{children}

<NeuralHUD/>

<ExecutionTimeline/>

</div>

)

}
