"use client";


import {useState} from "react";


export default function AutonomousEditor(){


const [code,setCode]=useState(
`// KLYN Autonomous Editor

function build(){

}
`
);


return (

<div
className="
h-full
rounded-xl
border
border-white/10
bg-[#0B0C10]
p-5
text-white
"
>


<textarea

value={code}

onChange={
e=>setCode(e.target.value)
}

className="
w-full
h-full
bg-transparent
outline-none
font-mono
text-sm
"

/>


</div>

);


}
