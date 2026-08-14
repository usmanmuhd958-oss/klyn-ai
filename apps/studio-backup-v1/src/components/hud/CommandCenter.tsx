"use client";

import IntentInput from "./IntentInput";
import AgentDecisionPanel from "./AgentDecisionPanel";


export default function CommandCenter(){

return (

<section
className="
min-h-screen
flex
flex-col
items-center
justify-center
gap-8
bg-[#0B0C10]
p-10
"
>

<h1
className="
text-4xl
font-bold
text-white
"
>
KLYN Intelligence Command Core
</h1>


<IntentInput
onSubmit={(intent)=>{

console.log(
"KLYN Intent:",
intent
);

}}
/>


<AgentDecisionPanel/>


</section>

);

}
