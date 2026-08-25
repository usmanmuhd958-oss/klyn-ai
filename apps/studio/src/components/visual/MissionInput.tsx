"use client";

export default function MissionInput(){

return (

<div className="
rounded-2xl
border border-white/10
bg-white/5
p-6
">

<h2 className="text-lg font-semibold">
Mission Core
</h2>

<textarea
placeholder="Describe what you want KLYN to build..."
className="
mt-5
h-32
w-full
rounded-xl
border
border-white/10
bg-black/30
p-4
outline-none
"
/>


<button
className="
mt-4
rounded-xl
bg-white
px-5
py-3
text-black
font-semibold
"
>
Execute Mission
</button>


</div>

);

}
