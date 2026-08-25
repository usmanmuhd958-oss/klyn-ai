"use client";

const metrics = [
{
name:"Project Intelligence",
value:"98%"
},
{
name:"Agent Coordination",
value:"12 agents"
},
{
name:"Code Understanding",
value:"Deep"
},
{
name:"Security",
value:"Protected"
}
];


export default function IntelligenceDashboard(){

return (

<section className="
rounded-2xl
border
border-white/10
bg-white/5
p-6
">

<h2 className="text-lg font-semibold">
KLYN Intelligence Core
</h2>

<div className="
grid
grid-cols-2
gap-4
mt-5
">

{metrics.map((item)=>(

<div
key={item.name}
className="
rounded-xl
border
border-white/10
p-4
"
>

<p className="text-xs text-gray-400">
{item.name}
</p>

<p className="mt-2 text-xl font-bold">
{item.value}
</p>

</div>

))}

</div>

</section>

);

}
